import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withWorkspace } from '@/lib/workspace-context'
import { removeLegacyAttachmentFile } from '@/lib/legacy-attachments'

export const runtime = 'nodejs'

// DELETE /api/attachments/[id] - remove a staged or campaign attachment.
export const DELETE = withWorkspace(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const attachment = await db.attachment.findUnique({ where: { id } })
  if (attachment) {
    await removeLegacyAttachmentFile(attachment.filepath)
    await db.attachment.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 })
})
