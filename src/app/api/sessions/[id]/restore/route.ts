import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// POST /api/sessions/[id]/restore - restore from trash
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await db.emailSession.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await db.emailSession.update({ where: { id }, data: { deletedAt: null } })
  return NextResponse.json({ ok: true })
}