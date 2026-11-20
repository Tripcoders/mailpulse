import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getNeonAuthConfig, getNeonAuthCookieSecret, INVITE_CLAIM_COOKIE } from '@/lib/neon-auth'
import { hashInvitationToken, signInviteClaim } from '@/lib/workspace-context'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!getNeonAuthConfig()) {
    return NextResponse.json({ error: 'Neon Auth is not configured for this deployment.' }, { status: 503 })
  }
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  if ((origin && origin !== new URL(request.url).origin) || fetchSite === 'cross-site') {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }

  let token = ''
  try {
    const body = await request.json()
    token = typeof body?.token === 'string' ? body.token.trim() : ''
  } catch {
    return NextResponse.json({ error: 'Invitation token is required.' }, { status: 400 })
  }
  if (token.length < 32 || token.length > 128) {
    return NextResponse.json({ error: 'This invitation is invalid or has expired.' }, { status: 404 })
  }

  const invitation = await db.workspaceInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    include: { workspace: { select: { name: true, status: true } } },
  })
  if (
    !invitation ||
    invitation.revokedAt ||
    invitation.acceptedAt ||
    invitation.expiresAt.getTime() <= Date.now() ||
    invitation.workspace.status !== 'active'
  ) {
    return NextResponse.json({ error: 'This invitation is invalid or has expired.' }, { status: 404 })
  }

  const secret = getNeonAuthCookieSecret()
  if (!secret) {
    return NextResponse.json({ error: 'Invitation claims are not configured.' }, { status: 503 })
  }
  const signedClaim = signInviteClaim(
    {
      invitationId: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt.getTime(),
    },
    secret,
  )

  const response = NextResponse.json({
    ok: true,
    email: invitation.email,
    workspaceName: invitation.workspace.name,
  })
  response.headers.set('Cache-Control', 'no-store')
  response.cookies.set({
    name: INVITE_CLAIM_COOKIE,
    value: signedClaim,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: invitation.expiresAt,
  })
  return response
}
