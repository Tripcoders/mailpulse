import { NextResponse } from 'next/server'
import { engineHealthy } from '@/lib/sender-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const checks: Record<string, any> = {
    app: 'ok',
  }
  try {
    const { db } = await import('@/lib/db')
    await db.$queryRaw`SELECT 1`
    checks.db = 'ok'
  } catch (e: any) {
    checks.db = 'down: ' + (e?.message || 'unknown')
  }
  
  // Test engine connection
  let engineDetail = 'unknown'
  try {
    const controlUrl = process.env.ENGINE_CONTROL_URL || 'http://localhost:3004'
    checks.controlUrl = controlUrl
    const res = await fetch(`${controlUrl}/health`, { signal: AbortSignal.timeout(5000) })
    checks.engineStatus = res.status
    checks.engineBody = await res.text()
    checks.engine = res.ok ? 'ok' : 'down'
  } catch (e: any) {
    checks.engine = 'down'
    checks.engineError = e?.message || 'unknown'
  }
  
  const hardDown = checks.db !== 'ok'
  return NextResponse.json(
    { ok: !hardDown, ...(checks) },
    { status: hardDown ? 503 : 200 }
  )
}
