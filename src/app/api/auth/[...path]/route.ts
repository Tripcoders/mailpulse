import { NextResponse } from 'next/server'
import { getNeonAuth } from '@/lib/neon-auth'
import { canCreateInitialOwner, isInviteClaimForEmail } from '@/lib/workspace-context'

export const runtime = 'nodejs'

type AuthRouteContext = { params: Promise<{ path: string[] }> }

async function unavailable() {
  return NextResponse.json(
    { error: 'Neon Auth is not configured for this deployment.' },
    { status: 503 },
  )
}

async function authorizeSignup(request: Request, context: AuthRouteContext) {
  const { path } = await context.params
  if (path[0] !== 'sign-up') return null

  let email = ''
  try {
    const body = await request.clone().json()
    email = typeof body?.email === 'string' ? body.email.trim() : ''
  } catch {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 })
  }
  if (!email) return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 })

  try {
    if (await isInviteClaimForEmail(request, email)) return null
    if (await canCreateInitialOwner(email)) return null
  } catch {
    return NextResponse.json({ error: 'Workspace authorization is temporarily unavailable.' }, { status: 503 })
  }
  return NextResponse.json(
    { error: 'Account creation requires a valid workspace invitation.' },
    { status: 403 },
  )
}

export async function GET(request: Request, context: AuthRouteContext) {
  const auth = getNeonAuth()
  if (!auth) return unavailable()
  return auth.handler().GET(request, context)
}

export async function POST(request: Request, context: AuthRouteContext) {
  const auth = getNeonAuth()
  if (!auth) return unavailable()
  const denied = await authorizeSignup(request, context)
  if (denied) return denied
  return auth.handler().POST(request, context)
}

export async function PUT(request: Request, context: AuthRouteContext) {
  const auth = getNeonAuth()
  if (!auth) return unavailable()
  return auth.handler().PUT(request, context)
}

export async function PATCH(request: Request, context: AuthRouteContext) {
  const auth = getNeonAuth()
  if (!auth) return unavailable()
  return auth.handler().PATCH(request, context)
}

export async function DELETE(request: Request, context: AuthRouteContext) {
  const auth = getNeonAuth()
  if (!auth) return unavailable()
  return auth.handler().DELETE(request, context)
}
