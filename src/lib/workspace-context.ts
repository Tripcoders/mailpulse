import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  ACTIVE_WORKSPACE_COOKIE,
  getNeonAuth,
  getNeonAuthCookieSecret,
  INVITE_CLAIM_COOKIE,
} from '@/lib/neon-auth'
import { db } from '@/lib/db'
import { runWithWorkspace, type WorkspaceContext, type WorkspaceRole } from '@/lib/workspace-store'

const BOOTSTRAP_WORKSPACE_ID = 'mailpulse-bootstrap'

type InviteClaim = {
  invitationId: string
  email: string
  expiresAt: number
}

type WorkspaceSelection = {
  workspaceId: string
  userId: string
  expiresAt: number
}

type ResolveResult =
  | {
      ok: true
      context: WorkspaceContext
      clearInviteClaim: boolean
      persistWorkspaceSelection: boolean
    }
  | { ok: false; status: number; code: string; error: string }

function normalizedEmail(value: string) {
  return value.trim().toLowerCase()
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get('cookie') || ''
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim()
    }
  }
  return null
}

export function signInviteClaim(claim: InviteClaim, secret: string) {
  const encoded = Buffer.from(JSON.stringify(claim)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return encoded + '.' + signature
}

function signWorkspaceSelection(selection: WorkspaceSelection, secret: string) {
  const encoded = Buffer.from(JSON.stringify(selection)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return encoded + '.' + signature
}

function verifyWorkspaceSelection(value: string | null, secret: string): WorkspaceSelection | null {
  if (!value) return null
  const [encoded, signature, extra] = value.split('.')
  if (!encoded || !signature || extra) return null
  const expected = createHmac('sha256', secret).update(encoded).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null

  try {
    const selection = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as WorkspaceSelection
    if (
      typeof selection.workspaceId !== 'string' ||
      typeof selection.userId !== 'string' ||
      typeof selection.expiresAt !== 'number' ||
      selection.expiresAt <= Date.now()
    ) {
      return null
    }
    return selection
  } catch {
    return null
  }
}

function verifyInviteClaim(value: string | null, secret: string): InviteClaim | null {
  if (!value) return null
  const [encoded, signature, extra] = value.split('.')
  if (!encoded || !signature || extra) return null

  const expected = createHmac('sha256', secret).update(encoded).digest()
  let actual: Buffer
  try {
    actual = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null

  try {
    const claim = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as InviteClaim
    if (
      typeof claim.invitationId !== 'string' ||
      typeof claim.email !== 'string' ||
      typeof claim.expiresAt !== 'number' ||
      claim.expiresAt <= Date.now()
    ) {
      return null
    }
    return claim
  } catch {
    return null
  }
}

export async function isInviteClaimForEmail(request: Request, email: string) {
  const secret = getNeonAuthCookieSecret()
  if (!secret) return false
  const claim = verifyInviteClaim(readCookie(request, INVITE_CLAIM_COOKIE), secret)
  if (!claim || normalizedEmail(claim.email) !== normalizedEmail(email)) return false

  const invitation = await db.workspaceInvitation.findUnique({
    where: { id: claim.invitationId },
    include: { workspace: { select: { status: true } } },
  })
  return Boolean(
    invitation &&
    invitation.email === normalizedEmail(email) &&
    !invitation.acceptedAt &&
    !invitation.revokedAt &&
    invitation.expiresAt.getTime() > Date.now() &&
    invitation.workspace.status === 'active',
  )
}

export async function canCreateInitialOwner(email: string) {
  const configuredEmail = process.env.NEON_INITIAL_OWNER_EMAIL
  if (!configuredEmail || normalizedEmail(configuredEmail) !== normalizedEmail(email)) return false
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId: BOOTSTRAP_WORKSPACE_ID },
    select: { id: true },
  })
  return !member
}

async function acceptInviteForVerifiedUser(
  claim: InviteClaim,
  user: { id: string; email: string },
): Promise<string> {
  if (normalizedEmail(claim.email) !== normalizedEmail(user.email)) {
    throw new Error('INVITE_EMAIL_MISMATCH')
  }

  return db.$transaction(async (tx) => {
    const invitation = await tx.workspaceInvitation.findUnique({
      where: { id: claim.invitationId },
      include: { workspace: { select: { id: true, status: true } } },
    })
    if (
      !invitation ||
      invitation.email !== normalizedEmail(user.email) ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= Date.now() ||
      invitation.workspace.status !== 'active'
    ) {
      throw new Error('INVITE_INVALID')
    }

    const existingMember = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: invitation.workspaceId,
          userId: user.id,
        },
      },
    })

    if (invitation.acceptedAt && !existingMember) {
      throw new Error('INVITE_ALREADY_USED')
    }

    if (!existingMember) {
      await tx.workspaceMember.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: user.id,
          email: normalizedEmail(user.email),
          role: invitation.role,
        },
      })
    }

    if (!invitation.acceptedAt) {
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      })
    }
    return invitation.workspaceId
  })
}

async function enrollInitialOwner(user: { id: string; email: string }) {
  const initialOwnerEmail = process.env.NEON_INITIAL_OWNER_EMAIL
  if (!initialOwnerEmail || normalizedEmail(initialOwnerEmail) !== normalizedEmail(user.email)) return false

  await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({ where: { id: BOOTSTRAP_WORKSPACE_ID } })
    if (!workspace || workspace.status !== 'active') {
      throw new Error('BOOTSTRAP_WORKSPACE_MISSING')
    }

    const firstMember = await tx.workspaceMember.findFirst({
      where: { workspaceId: BOOTSTRAP_WORKSPACE_ID },
      select: { id: true },
    })
    if (firstMember) return

    await tx.workspaceMember.create({
      data: {
        workspaceId: BOOTSTRAP_WORKSPACE_ID,
        userId: user.id,
        email: normalizedEmail(user.email),
        role: 'owner',
      },
    })
  })
  return true
}

async function resolveWorkspaceContext(request: Request): Promise<ResolveResult> {
  const auth = getNeonAuth()
  if (!auth) {
    return {
      ok: false,
      status: 503,
      code: 'neon_auth_not_configured',
      error: 'Neon Auth is not configured for this deployment.',
    }
  }

  let authResult
  try {
    authResult = await auth.getSession()
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'auth_service_unavailable',
      error: 'The authentication service is temporarily unavailable.',
    }
  }

  const sessionData = authResult?.data as
    | { user?: { id?: string; email?: string; emailVerified?: boolean; name?: string } | null }
    | null
    | undefined
  const user = sessionData?.user
  if (!user?.id || !user.email) {
    return { ok: false, status: 401, code: 'not_authenticated', error: 'Sign in to continue.' }
  }
  if (user.emailVerified !== true) {
    return {
      ok: false,
      status: 403,
      code: 'email_not_verified',
      error: 'Verify your email address before accessing a workspace.',
    }
  }

  let acceptedWorkspaceId: string | null = null
  let clearInviteClaim = false
  const cookieSecret = getNeonAuthCookieSecret()
  const workspaceSelection = cookieSecret
    ? verifyWorkspaceSelection(readCookie(request, ACTIVE_WORKSPACE_COOKIE), cookieSecret)
    : null
  const claimValue = readCookie(request, INVITE_CLAIM_COOKIE)
  const claim = cookieSecret ? verifyInviteClaim(claimValue, cookieSecret) : null
  if (claim) {
    try {
      acceptedWorkspaceId = await acceptInviteForVerifiedUser(claim, { id: user.id, email: user.email })
      clearInviteClaim = true
    } catch (error) {
      if (error instanceof Error && error.message === 'INVITE_EMAIL_MISMATCH') {
        return {
          ok: false,
          status: 403,
          code: 'invite_email_mismatch',
          error: 'Sign in with the email address this invitation was sent to.',
        }
      }
      if (error instanceof Error && error.message.startsWith('INVITE_')) {
        return { ok: false, status: 403, code: 'invite_invalid', error: 'This invitation is expired or has already been used.' }
      }
      throw error
    }
  }

  let memberships = await db.workspaceMember.findMany({
    where: { userId: user.id },
    include: {
      workspace: {
        select: { id: true, name: true, slug: true, status: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (memberships.length === 0) {
    try {
      const enrolled = await enrollInitialOwner({ id: user.id, email: user.email })
      if (enrolled) {
        memberships = await db.workspaceMember.findMany({
          where: { userId: user.id },
          include: {
            workspace: {
              select: { id: true, name: true, slug: true, status: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        })
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'BOOTSTRAP_WORKSPACE_MISSING') {
        return {
          ok: false,
          status: 503,
          code: 'workspace_migration_required',
          error: 'The Neon workspace migration must be applied before MailPulse can be used.',
        }
      }
      throw error
    }
  }

  const activeMemberships = memberships.filter((member) => member.workspace.status === 'active')
  if (activeMemberships.length === 0) {
    return {
      ok: false,
      status: 403,
      code: 'workspace_invitation_required',
      error: 'Your verified account does not belong to an active MailPulse workspace.',
    }
  }

  const requestedWorkspaceId = request.headers.get('x-mailpulse-workspace-id')
  let selectedMembership: (typeof activeMemberships)[number] | undefined
  if (requestedWorkspaceId) {
    selectedMembership = activeMemberships.find((member) => member.workspaceId === requestedWorkspaceId)
  } else if (acceptedWorkspaceId) {
    selectedMembership = activeMemberships.find((member) => member.workspaceId === acceptedWorkspaceId)
  } else if (workspaceSelection?.userId === user.id) {
    selectedMembership =
      activeMemberships.find((member) => member.workspaceId === workspaceSelection.workspaceId) ||
      activeMemberships[0]
  } else {
    selectedMembership = activeMemberships[0]
  }

  if (!selectedMembership) {
    return {
      ok: false,
      status: 403,
      code: 'workspace_access_denied',
      error: 'You do not have access to the requested workspace.',
    }
  }

  const role = selectedMembership.role as WorkspaceRole
  const context: WorkspaceContext = {
    userId: user.id,
    email: normalizedEmail(user.email),
    workspaceId: selectedMembership.workspace.id,
    workspaceSlug: selectedMembership.workspace.slug,
    workspaceName: selectedMembership.workspace.name,
    role,
  }
  const selectionIsCurrent =
    workspaceSelection?.userId === user.id &&
    workspaceSelection.workspaceId === selectedMembership.workspace.id &&
    workspaceSelection.expiresAt > Date.now() + 7 * 24 * 60 * 60 * 1000
  return {
    ok: true,
    context,
    clearInviteClaim,
    persistWorkspaceSelection: !selectionIsCurrent,
  }
}

function roleLevel(role: WorkspaceRole) {
  return { viewer: 1, sender: 2, admin: 3, owner: 4 }[role] || 0
}

function expireInviteClaimCookie(response: Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.headers.append(
    'Set-Cookie',
    INVITE_CLAIM_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + secure,
  )
}

function persistWorkspaceSelectionCookie(response: Response, context: WorkspaceContext) {
  const secret = getNeonAuthCookieSecret()
  if (!secret) return
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
  const value = signWorkspaceSelection(
    { userId: context.userId, workspaceId: context.workspaceId, expiresAt },
    secret,
  )
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.headers.append(
    'Set-Cookie',
    ACTIVE_WORKSPACE_COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000' + secure,
  )
}

type WorkspaceOptions = {
  readRole?: WorkspaceRole
  writeRole?: WorkspaceRole
}

export function withWorkspace<Args extends [Request, ...unknown[]]>(
  handler: (...args: Args) => Promise<Response>,
  options: WorkspaceOptions = {},
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    const request = args[0]
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())
    if (mutating) {
      const origin = request.headers.get('origin')
      const fetchSite = request.headers.get('sec-fetch-site')
      if ((origin && origin !== new URL(request.url).origin) || fetchSite === 'cross-site') {
        return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 })
      }
    }

    try {
      const resolved = await resolveWorkspaceContext(request)
      if (!resolved.ok) {
        return NextResponse.json(
          { error: resolved.error, code: resolved.code },
          { status: resolved.status },
        )
      }

      const requiredRole = mutating ? options.writeRole || 'sender' : options.readRole || 'viewer'
      if (roleLevel(resolved.context.role) < roleLevel(requiredRole)) {
        return NextResponse.json(
          { error: 'Your workspace role does not allow this action.', code: 'insufficient_workspace_role' },
          { status: 403 },
        )
      }

      const response = await runWithWorkspace(resolved.context, () => handler(...args))
      response.headers.set('Cache-Control', 'private, no-store, max-age=0')
      if (resolved.persistWorkspaceSelection) {
        persistWorkspaceSelectionCookie(response, resolved.context)
      }
      if (resolved.clearInviteClaim) expireInviteClaimCookie(response)
      return response
    } catch (error) {
      console.error('workspace request failed', error instanceof Error ? error.name : 'UnknownError')
      return NextResponse.json(
        { error: 'The workspace request could not be completed.' },
        { status: 503 },
      )
    }
  }
}

export async function getVerifiedWorkspaceContext(request: Request) {
  return resolveWorkspaceContext(request)
}

export function hashInvitationToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
