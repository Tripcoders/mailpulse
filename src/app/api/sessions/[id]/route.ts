import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rm } from 'fs/promises'

export const runtime = 'nodejs'

// GET /api/sessions/[id] - full session details
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await db.emailSession.findUnique({
    where: { id },
    include: { attachments: true },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // status breakdown
  const breakdown = await db.emailRecipient.groupBy({
    by: ['status'],
    where: { sessionId: id },
    _count: true,
  })

  return NextResponse.json({ session, breakdown })
}

// DELETE /api/sessions/[id] - delete session + recipients + attachments + logs
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const attachments = await db.attachment.findMany({ where: { sessionId: id } })
  for (const a of attachments) {
    try { await rm(a.filepath, { force: true }) } catch {}
  }
  await db.emailSession.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
