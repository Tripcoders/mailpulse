import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/sessions - list all sessions (most recent first), excluding soft-deleted
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const trash = url.searchParams.get('trash') === '1'
  const sessions = await db.emailSession.findMany({
    where: trash ? { deletedAt: { not: null } } : { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, color: true, status: true, totalEmails: true, sentCount: true,
      failedCount: true, pendingCount: true, fromName: true, fromEmail: true,
      providerType: true, subject: true, createdAt: true, startedAt: true, completedAt: true,
      deletedAt: true,
    },
  })
  return NextResponse.json({ sessions })
}

// POST /api/sessions - create a new session (draft) with recipients + content
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      name, color, fromName, fromEmail,
      providerType, smtpHost, smtpPort, smtpSecure,
      subject, bodyHtml, plainText,
      signatureText, signatureImage,
      batchSize, batchDelayMs, perEmailDelayMs,
      recipients, attachments,
    } = body

    if (!fromEmail || !subject || !bodyHtml) {
      return NextResponse.json({ error: 'fromEmail, subject and bodyHtml are required' }, { status: 400 })
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ error: 'At least one recipient is required' }, { status: 400 })
    }
    if (recipients.length > 1000) {
      return NextResponse.json({ error: 'Maximum 1000 recipients per session' }, { status: 400 })
    }

    const session = await db.emailSession.create({
      data: {
        name: name || `Session ${new Date().toLocaleString()}`,
        color: color || '#3b82f6',
        fromName: fromName || fromEmail.split('@')[0],
        fromEmail,
        providerType: providerType || 'smtp',
        smtpHost: smtpHost || null,
        smtpPort: smtpPort ? Number(smtpPort) : null,
        smtpSecure: smtpSecure ?? null,
        subject,
        bodyHtml,
        plainText: plainText || null,
        signatureText: signatureText || null,
        signatureImage: signatureImage || null,
        batchSize: Number(batchSize) || 10,
        batchDelayMs: Number(batchDelayMs) || 2000,
        perEmailDelayMs: Number(perEmailDelayMs) || 500,
        totalEmails: recipients.length,
        pendingCount: recipients.length,
        status: 'draft',
        recipients: {
          create: recipients.map((r: { email: string; name: string }) => ({
            email: r.email,
            name: r.name || '',
          })),
        },
        attachments: attachments && attachments.length > 0
          ? { create: attachments.map((a: any) => ({ filename: a.filename, filepath: a.filepath, mimetype: a.mimetype, size: a.size })) }
          : undefined,
      },
      include: { recipients: { select: { id: true, email: true, name: true, status: true } }, attachments: true },
    })

    return NextResponse.json({ session })
  } catch (e: any) {
    console.error('create session error', e)
    return NextResponse.json({ error: e?.message || 'Failed to create session' }, { status: 500 })
  }
}
