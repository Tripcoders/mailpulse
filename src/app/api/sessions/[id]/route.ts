import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withWorkspace } from '@/lib/workspace-context'
import { removeLegacyAttachmentFile } from '@/lib/legacy-attachments'

export const runtime = 'nodejs'

// GET /api/sessions/[id] - full session details
export const GET = withWorkspace(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const session = await db.emailSession.findUnique({
    where: { id },
    include: {
      attachments: {
        select: { id: true, sessionId: true, filename: true, mimetype: true, size: true, createdAt: true },
      },
    },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // status breakdown
  const breakdown = await db.emailRecipient.groupBy({
    by: ['status'],
    where: { sessionId: id },
    _count: true,
  })

  return NextResponse.json({ session, breakdown })
})

// DELETE /api/sessions/[id] - soft delete (move to trash)
export const DELETE = withWorkspace(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const url = new URL(req.url)
  const permanent = url.searchParams.get('permanent') === '1'
  if (permanent) {
    const attachments = await db.attachment.findMany({
      where: { sessionId: id },
      select: { filepath: true },
    })
    for (const a of attachments) {
      await removeLegacyAttachmentFile(a.filepath)
    }
    await db.emailSession.delete({ where: { id } })
    return NextResponse.json({ ok: true, permanent: true })
  }
  await db.emailSession.update({ where: { id }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true, trashed: true })
})
