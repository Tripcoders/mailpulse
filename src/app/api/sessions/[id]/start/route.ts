import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { startSession } from '@/lib/sender-client'

export const runtime = 'nodejs'

// POST /api/sessions/[id]/start
// Body: { smtpUser, smtpPass }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await db.emailSession.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const body = await req.json()
  const { smtpUser, smtpPass } = body
  if (!smtpUser || !smtpPass) {
    return NextResponse.json({ error: 'SMTP user and password (app password) are required' }, { status: 400 })
  }

  try {
    await startSession(id, smtpUser, smtpPass)
    return NextResponse.json({ ok: true, sessionId: id })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to start session' }, { status: 502 })
  }
}
