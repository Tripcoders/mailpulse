import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ENGINE_URL: process.env.ENGINE_URL || '(not set)',
    ENGINE_CONTROL_URL: process.env.ENGINE_CONTROL_URL || '(not set)',
    NEXT_PUBLIC_ENGINE_URL: process.env.NEXT_PUBLIC_ENGINE_URL || '(not set)',
    VERCEL: process.env.VERCEL || '(not set)',
  })
}