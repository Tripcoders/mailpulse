import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withWorkspace } from '@/lib/workspace-context'
import { currentWorkspaceContext } from '@/lib/workspace-store'

export const runtime = 'nodejs'

const MAX_QUEUE_DELAY_MS = 6 * 24 * 60 * 60 * 1000

function readBoundedInteger(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

export const GET = withWorkspace(async (req: NextRequest) => {
  const url = new URL(req.url)
  const trash = url.searchParams.get('trash') === '1'
  const sessions = await db.emailSession.findMany({
    where: trash ? { deletedAt: { not: null } } : { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, color: true, category: true, status: true, totalEmails: true, sentCount: true,
      failedCount: true, pendingCount: true, fromName: true, fromEmail: true,
      providerType: true, subject: true, createdAt: true, startedAt: true, completedAt: true,
      deletedAt: true,
    },
  })
  return NextResponse.json({ sessions })
})

export const POST = withWorkspace(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const {
      name, color, category, fromName, fromEmail,
      providerType, smtpHost, smtpPort, smtpSecure,
      subject, bodyHtml, plainText,
      signatureText, signatureImage,
      batchSize, batchDelayMs, perEmailDelayMs,
      recipients, attachments,
    } = body

    if (typeof fromEmail !== 'string' || typeof subject !== 'string' || typeof bodyHtml !== 'string') {
      return NextResponse.json({ error: 'fromEmail, subject and bodyHtml are required' }, { status: 400 })
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ error: 'At least one recipient is required' }, { status: 400 })
    }
    if (recipients.length > 1000) {
      return NextResponse.json({ error: 'Maximum 1000 recipients per session' }, { status: 400 })
    }

    const normalizedBatchSize = readBoundedInteger(batchSize, 10, 1, 100)
    const normalizedBatchDelay = readBoundedInteger(batchDelayMs, 2000, 0, MAX_QUEUE_DELAY_MS)
    const normalizedPerEmailDelay = readBoundedInteger(perEmailDelayMs, 500, 0, MAX_QUEUE_DELAY_MS)
    const hasSmtpPort = smtpPort !== undefined && smtpPort !== null && smtpPort !== ''
    const normalizedSmtpPort = hasSmtpPort ? readBoundedInteger(smtpPort, 587, 1, 65535) : null
    if (normalizedBatchSize === null || normalizedBatchDelay === null || normalizedPerEmailDelay === null) {
      return NextResponse.json({ error: 'Batch size must be 1-100, and send delays must be between 0 and six days.' }, { status: 400 })
    }
    if (hasSmtpPort && normalizedSmtpPort === null) {
      return NextResponse.json({ error: 'SMTP port must be a number between 1 and 65535.' }, { status: 400 })
    }

    if (typeof fromEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail.trim()) || fromEmail.trim().length > 254) {
      return NextResponse.json({ error: 'Enter a valid sender email address.' }, { status: 400 })
    }

    const normalizedRecipients = recipients.map((recipient: any) => ({
      email: typeof recipient?.email === 'string' ? recipient.email.trim() : '',
      name: typeof recipient?.name === 'string' ? recipient.name.trim().slice(0, 200) : '',
    }))
    if (normalizedRecipients.some((recipient: { email: string }) =>
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email) || recipient.email.length > 254,
    )) {
      return NextResponse.json({ error: 'Every recipient must have a valid email address.' }, { status: 400 })
    }

    if (attachments !== undefined && !Array.isArray(attachments)) {
      return NextResponse.json({ error: 'Attachments must be a list of staged uploads.' }, { status: 400 })
    }
    const attachmentInputs: unknown[] = attachments || []
    if (attachmentInputs.length > 10) {
      return NextResponse.json({ error: 'A campaign can include up to 10 attachments.' }, { status: 400 })
    }
    const attachmentIds = attachmentInputs.map((item: any) => item?.stagingId)
    if (
      attachmentIds.some((id: unknown) => typeof id !== 'string' || id.length < 8 || id.length > 64) ||
      new Set(attachmentIds).size !== attachmentIds.length
    ) {
      return NextResponse.json({ error: 'One or more staged attachments are invalid.' }, { status: 400 })
    }

    const context = currentWorkspaceContext()
    const now = new Date()
    const result = await db.$transaction(async (tx) => {
      const staged = attachmentIds.length
        ? await tx.attachment.findMany({
            where: {
              id: { in: attachmentIds as string[] },
              workspaceId: context.workspaceId,
              sessionId: null,
              expiresAt: { gt: now },
            },
            select: { id: true, size: true },
          })
        : []

      if (staged.length !== attachmentIds.length) return { error: 'staged' as const }
      if (staged.reduce((total, attachment) => total + attachment.size, 0) > 18 * 1024 * 1024) {
        return { error: 'total_size' as const }
      }

      const created = await tx.emailSession.create({
        data: {
          workspaceId: context.workspaceId,
          name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 160) : 'Session ' + new Date().toLocaleString(),
          color: typeof color === 'string' ? color.slice(0, 32) : '#3b82f6',
          category: typeof category === 'string' ? category.slice(0, 100) : 'General',
          fromName: typeof fromName === 'string' && fromName.trim() ? fromName.trim().slice(0, 200) : fromEmail.split('@')[0],
          fromEmail: fromEmail.trim(),
          providerType: typeof providerType === 'string' ? providerType.slice(0, 32) : 'smtp',
          smtpHost: typeof smtpHost === 'string' ? smtpHost.slice(0, 255) : null,
          smtpPort: normalizedSmtpPort,
          smtpSecure: typeof smtpSecure === 'boolean' ? smtpSecure : null,
          subject: subject.slice(0, 998),
          bodyHtml,
          plainText: typeof plainText === 'string' ? plainText : null,
          signatureText: typeof signatureText === 'string' ? signatureText : null,
          signatureImage: typeof signatureImage === 'string' ? signatureImage : null,
          batchSize: normalizedBatchSize,
          batchDelayMs: normalizedBatchDelay,
          perEmailDelayMs: normalizedPerEmailDelay,
          totalEmails: normalizedRecipients.length,
          pendingCount: normalizedRecipients.length,
          status: 'draft',
          recipients: {
            create: normalizedRecipients.map((recipient: { email: string; name: string }) => ({
              ...recipient,
              workspaceId: context.workspaceId,
            })),
          },
        },
      })

      if (attachmentIds.length) {
        const claimed = await tx.attachment.updateMany({
          where: {
            id: { in: attachmentIds as string[] },
            workspaceId: context.workspaceId,
            sessionId: null,
            expiresAt: { gt: now },
          },
          data: { sessionId: created.id, expiresAt: null },
        })
        if (claimed.count !== attachmentIds.length) throw new Error('ATTACHMENT_CLAIM_RACE')
      }

      const session = await tx.emailSession.findUnique({
        where: { id: created.id, workspaceId: context.workspaceId },
        include: {
          recipients: { select: { id: true, email: true, name: true, status: true } },
          attachments: {
            select: { id: true, sessionId: true, filename: true, mimetype: true, size: true, createdAt: true },
          },
        },
      })
      if (!session) throw new Error('CREATED_SESSION_MISSING')
      return { session } as const
    })

    if ('error' in result) {
      const isStagedError = result.error === 'staged'
      return NextResponse.json(
        {
          error: isStagedError
            ? 'An attachment expired or was already added to a campaign. Upload it again to continue.'
            : 'The combined attachment size must be 18 MiB or less.',
        },
        { status: isStagedError ? 409 : 413 },
      )
    }

    return NextResponse.json({ session: result.session })
  } catch (error) {
    console.error('Create campaign failed:', error instanceof Error ? error.name : 'UnknownError')
    if (error instanceof Error && error.message === 'ATTACHMENT_CLAIM_RACE') {
      return NextResponse.json({ error: 'An attachment was already used by another campaign. Upload it again to continue.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create campaign. Please try again.' }, { status: 500 })
  }
})
