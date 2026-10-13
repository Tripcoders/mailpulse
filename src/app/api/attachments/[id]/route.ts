import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rm } from 'fs/promises'

export const runtime = 'nodejs'

// DELETE /api/attachments/[id] - remove an attachment (DB record + file)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const attachment = await db.attachment.findUnique({ where: { id } })
  if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try { await rm(attachment.filepath, { force: true }) } catch {}
  await db.attachment.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
