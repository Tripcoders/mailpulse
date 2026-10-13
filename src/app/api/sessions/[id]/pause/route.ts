import { NextRequest, NextResponse } from 'next/server'
import { pauseSession } from '@/lib/sender-client'
export const runtime = 'nodejs'
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await pauseSession(id)
  return NextResponse.json({ ok: true })
}
