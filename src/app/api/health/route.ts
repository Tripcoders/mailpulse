import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { engineHealthy } from '@/lib/sender-client'
import { getEngineApiToken } from '@/lib/engine-auth'
import { hasCampaignQueueSchema, isVercelCampaignQueueEnabled } from '@/lib/campaign-queue'
import { getNeonAuthConfig } from '@/lib/neon-auth'
import { hasStableEncryptionKey } from '@/lib/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/health — liveness of the whole stack for the UI status dot and
// for uptime monitors in production.
export async function GET() {
  const checkedAt = new Date().toISOString()
  const queueMode = isVercelCampaignQueueEnabled()
  const checks: Record<string, any> = {
    app: 'ok',
    auth: getNeonAuthConfig() ? 'ok' : 'missing',
    smtpProfileEncryption: hasStableEncryptionKey() ? 'ok' : 'missing',
    senderMode: queueMode ? 'vercel-queue' : 'persistent-worker',
  }
  try {
    await db.$queryRaw`SELECT 1`
    checks.db = 'ok'
  } catch {
    checks.db = 'down'
  }
  if (queueMode) {
    checks.engineControlAuth = 'not_required'
    if (checks.db === 'ok') {
      try {
        checks.queueSchema = (await hasCampaignQueueSchema()) ? 'ok' : 'missing'
      } catch {
        checks.queueSchema = 'unavailable'
      }
    } else {
      checks.queueSchema = 'unavailable'
    }
    checks.engine = checks.queueSchema === 'ok' ? 'ok' : 'down'
    checks.queueTransport = 'unverified'
  } else {
    checks.engine = (await engineHealthy()) ? 'ok' : 'down'
    checks.engineControlAuth = getEngineApiToken() ? 'ok' : 'missing'
  }
  const hardDown =
    checks.db !== 'ok' ||
    checks.auth !== 'ok' ||
    checks.smtpProfileEncryption !== 'ok' ||
    (queueMode
      ? checks.queueSchema !== 'ok' || checks.engine !== 'ok'
      : checks.engine !== 'ok' || checks.engineControlAuth !== 'ok')
  return NextResponse.json(
    { ok: !hardDown, checkedAt, ...checks },
    { status: hardDown ? 503 : 200, headers: { 'Cache-Control': 'no-store' } }
  )
}
