import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/crypto'
import { startSession } from '@/lib/sender-client'
import { normalizeSmtpPassword } from '@/lib/smtp'
import type { ProviderType } from '@/lib/types'
import { withWorkspace } from '@/lib/workspace-context'
import { isVercelCampaignQueueEnabled } from '@/lib/campaign-queue'
import { CampaignStartError, startQueuedCampaign } from '@/lib/campaign-queue-service'

export const runtime = 'nodejs'
export const maxDuration = 60

// POST /api/sessions/[id]/start
// Body: { smtpUser, smtpPass }  OR  { profileId } to decrypt a saved profile's
// password server-side (AES-256-GCM; the password never touches the client).
export const POST = withWorkspace(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json().catch(() => null)

  if (isVercelCampaignQueueEnabled()) {
    try {
      const result = await startQueuedCampaign(id, body && typeof body === 'object' ? body : undefined)
      return NextResponse.json(result, { status: 202, headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof CampaignStartError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      console.error('Campaign queue start failed:', error instanceof Error ? error.name : 'UnknownError')
      return NextResponse.json({ error: 'The campaign could not be queued. Check the campaign progress and try again.' }, { status: 503 })
    }
  }

  const session = await db.emailSession.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  let { smtpUser, smtpPass } = body || {}

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

  smtpUser = String(smtpUser).trim()
  smtpPass = normalizeSmtpPassword(session.providerType as ProviderType, String(smtpPass), session.smtpHost)
  if (!smtpUser || !smtpPass) {
    return NextResponse.json({ error: 'SMTP user and password (app password) are required' }, { status: 400 })
  }

  if (session.providerType === 'smtp' && !session.smtpHost) {
    return NextResponse.json({ error: 'SMTP host is required for custom SMTP. Please go back to Sender & SMTP and enter your SMTP server address (e.g., smtp.gmail.com).' }, { status: 400 })
  }

  try {
    await startSession(id, smtpUser, smtpPass)
    return NextResponse.json({ ok: true, sessionId: id })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to start session' }, { status: 502 })
  }
})
