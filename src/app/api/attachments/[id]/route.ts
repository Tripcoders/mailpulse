import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rm } from 'fs/promises'
import { join } from 'path'

// Mirrors the upload route: repo-local by default, UPLOAD_DIR in deployment.
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'upload')

export const runtime = 'nodejs'

// DELETE /api/attachments/[id] - remove an attachment.
// Handles both a saved DB attachment row (record + file) and a staged upload
// (stagingId returned by /api/attachments/upload, file lives in ./upload/<stagingId>/).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // 1) Saved attachment: find the record, delete file + row.
  const attachment = await db.attachment.findUnique({ where: { id } })
  if (attachment) {
    try { await rm(attachment.filepath, { force: true }) } catch {}
    await db.attachment.delete({ where: { id } })
    return NextResponse.json({ ok: true, type: 'saved' })
  }

  // 2) Staged upload: only ids that are safe filesystem names (UUID from the
  // upload route) — never traverse outside ./upload.
  if (/^[a-zA-Z0-9._-]{8,64}$/.test(id)) {
    await rm(join(UPLOAD_DIR, id), { recursive: true, force: true })
    return NextResponse.json({ ok: true, type: 'staged' })
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
