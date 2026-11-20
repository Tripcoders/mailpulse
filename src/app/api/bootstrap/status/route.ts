import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getNeonAuthConfig } from '@/lib/neon-auth'

export const runtime = 'nodejs'

export async function GET() {
  if (!getNeonAuthConfig() || !process.env.NEON_INITIAL_OWNER_EMAIL) {
    return NextResponse.json({ available: false }, { headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId: 'mailpulse-bootstrap' },
      select: { id: true },
    })
    return NextResponse.json({ available: !member }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json(
      { available: false, error: 'The Neon workspace migration must be applied first.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
