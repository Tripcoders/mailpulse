import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withWorkspace } from '@/lib/workspace-context'
import { getSafeLegacyAttachmentPath } from '@/lib/legacy-attachments'
import { readFile } from 'node:fs/promises'

export const runtime = 'nodejs'

// POST /api/sessions/[id]/duplicate — reuse a campaign as a fresh draft.
// Copies content, throttle config, recipients (reset to pending) and attachment
// FILES (so deleting the original never breaks the copy). SMTP credentials are
// never stored, so the copy starts without them — re-enter at send time.
export const POST = withWorkspace(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params
    const source = await db.emailSession.findUnique({
      where: { id },
      include: { recipients: true, attachments: true },
    })
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let name = `Copy of ${source.name}`
    try {
      const body = await req.json().catch(() => ({}))
      if (body?.name?.trim()) name = body.name.trim()
    } catch {}

    const copiedAttachments: {
      filename: string
      filepath: null
      content: Buffer
      mimetype: string
      size: number
    }[] = []
    for (const a of source.attachments) {
      try {
        let content = a.content ? Buffer.from(a.content) : null
        if (!content && a.filepath) {
          const safePath = getSafeLegacyAttachmentPath(a.filepath)
          if (safePath) content = await readFile(safePath)
        }
        if (!content) continue
        copiedAttachments.push({
          filename: a.filename,
          filepath: null,
          content,
          mimetype: a.mimetype,
          size: content.byteLength,
        })
      } catch {
        // Skip unreadable files rather than failing the whole duplicate.
      }
    }

    const copy = await db.emailSession.create({
      data: {
        name,
        color: source.color,
        category: source.category,
        fromName: source.fromName,
        fromEmail: source.fromEmail,
        providerType: source.providerType,
        smtpHost: source.smtpHost,
        smtpPort: source.smtpPort,
        smtpSecure: source.smtpSecure,
        subject: source.subject,
        bodyHtml: source.bodyHtml,
        plainText: source.plainText,
        signatureText: source.signatureText,
        signatureImage: source.signatureImage,
        batchSize: source.batchSize,
        batchDelayMs: source.batchDelayMs,
        perEmailDelayMs: source.perEmailDelayMs,
        totalEmails: source.recipients.length,
        pendingCount: source.recipients.length,
        status: 'draft',
        recipients: {
          create: source.recipients.map((r) => ({ email: r.email, name: r.name })),
        },
        attachments: copiedAttachments.length > 0 ? { create: copiedAttachments } : undefined,
      },
    })

    await db.sendLog.create({
      data: { sessionId: copy.id, level: 'info', message: `Duplicated from campaign "${source.name}" (${source.recipients.length} recipients, ${copiedAttachments.length}/${source.attachments.length} attachments copied)` },
    })

    return NextResponse.json({ session: copy })
  } catch (e: any) {
    console.error('duplicate session error', e)
    return NextResponse.json({ error: e?.message || 'Failed to duplicate campaign' }, { status: 500 })
  }
})
