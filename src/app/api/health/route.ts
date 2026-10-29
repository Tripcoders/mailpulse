import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { engineHealthy } from '@/lib/sender-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/health — liveness of the whole stack for the UI status dot and
// for uptime monitors in production.
export async function GET() {
  const checks: Record<string, any> = {
    app: 'ok',
  }
  try {
    await db.$queryRaw`SELECT 1`
    checks.db = 'ok'
  } catch {
    checks.db = 'down (read-only FS on Vercel)'
  }
  checks.engine = (await engineHealthy()) ? 'ok' : 'down'
  const hardDown = checks.db !== 'ok'
  return NextResponse.json(
    { ok: !hardDown, ...(checks) },
    { status: hardDown ? 503 : 200 }
  )
}
