import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/crypto'
import { startSession } from '@/lib/sender-client'

export const runtime = 'nodejs'

// POST /api/sessions/[id]/start
// Body: { smtpUser, smtpPass }  OR  { profileId } to decrypt a saved profile's
// password server-side (AES-256-GCM; the password never touches the client).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await db.emailSession.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const body = await req.json()
  let { smtpUser, smtpPass } = body

  if (body.profileId) {
    const profile = await db.smtpProfile.findUnique({ where: { id: body.profileId } })
    if (!profile) return NextResponse.json({ error: 'Saved profile not found' }, { status: 404 })
    smtpPass = decryptSecret(profile.smtpPassEnc)
    if (!smtpPass) return NextResponse.json({ error: 'Saved profile has no remembered password' }, { status: 400 })
    smtpUser = profile.smtpUser
    await db.smtpProfile.update({ where: { id: profile.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }

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
