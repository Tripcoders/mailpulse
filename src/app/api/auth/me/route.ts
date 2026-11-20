import { NextResponse } from 'next/server'
import { getNeonAuth } from '@/lib/neon-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = getNeonAuth()
  if (!auth) {
    return NextResponse.json({ authenticated: false, reason: 'auth_not_configured' }, { status: 200 })
  }

  try {
    const result = await auth.getSession()
    const user = (result?.data as { user?: { id?: string; email?: string; emailVerified?: boolean } | null })?.user
    if (user?.id && user.email) {
      // Try to enroll as initial owner if no workspace exists
      try {
        const { db } = await import('@/lib/db')
        const membership = await db.workspaceMember.findFirst({ where: { userId: user.id } })
        if (!membership && process.env.NEON_INITIAL_OWNER_EMAIL && user.email.toLowerCase() === process.env.NEON_INITIAL_OWNER_EMAIL.toLowerCase()) {
          const ws = await db.workspace.findUnique({ where: { id: 'mailpulse-bootstrap' } })
          if (ws && ws.status === 'active') {
            const firstMember = await db.workspaceMember.findFirst({ where: { workspaceId: 'mailpulse-bootstrap' } })
            if (!firstMember) {
              await db.workspaceMember.create({
                data: { workspaceId: 'mailpulse-bootstrap', userId: user.id, email: user.email.toLowerCase(), role: 'owner' },
              })
            }
          }
        }
      } catch (e) {
        // Non-fatal
      }
      return NextResponse.json({ authenticated: true, email: user.email, emailVerified: user.emailVerified === true }, { status: 200 })
    }
    return NextResponse.json({ authenticated: false, reason: 'no_user_in_session', debug: JSON.stringify(result?.data) }, { status: 200 })
  } catch (e) {
    return NextResponse.json({ authenticated: false, reason: 'exception', error: e instanceof Error ? e.message : 'unknown' }, { status: 200 })
  }
}