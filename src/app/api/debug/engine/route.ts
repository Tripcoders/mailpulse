import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const controlUrl = process.env.ENGINE_CONTROL_URL || 'http://localhost:3004'
  let result: any = { controlUrl }
  try {
    const res = await fetch(`${controlUrl}/health`, { signal: AbortSignal.timeout(10000) })
    result.status = res.status
    result.body = await res.text()
    result.ok = res.ok
  } catch (e: any) {
    result.error = e?.message || 'unknown'
  }
  return NextResponse.json(result)
}