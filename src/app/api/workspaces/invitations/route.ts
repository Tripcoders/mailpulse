import { randomBytes, createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withWorkspace } from '@/lib/workspace-context'
import { currentWorkspaceContext } from '@/lib/workspace-store'

export const runtime = 'nodejs'

function normalizedEmail(value: string) {
  return value.trim().toLowerCase()
}

function publicInvitation(invitation: {
  id: string
  email: string
  role: string
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
  }
}

export const GET = withWorkspace(
  async (_request: NextRequest) => {
    const context = currentWorkspaceContext()
    const invitations = await db.workspaceInvitation.findMany({
      where: {
        workspaceId: context.workspaceId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ invitations: invitations.map(publicInvitation) })
  },
  { readRole: 'admin' },
)

export const POST = withWorkspace(
  async (request: NextRequest) => {
    const context = currentWorkspaceContext()
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
    }

    const email = normalizedEmail(typeof body.email === 'string' ? body.email : '')
    const requestedRole = body.role
    if (!['viewer', 'sender', 'admin'].includes(requestedRole as string)) {
      return NextResponse.json({ error: 'Choose a valid workspace role.' }, { status: 400 })
    }
    if (requestedRole === 'admin' && context.role !== 'owner') {
      return NextResponse.json({ error: 'Only a workspace owner can invite administrators.' }, { status: 403 })
    }
    const role = requestedRole as 'viewer' | 'sender' | 'admin'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    }

    const existingMember = await db.workspaceMember.findFirst({
      where: { workspaceId: context.workspaceId, email },
      select: { id: true },
    })
    if (existingMember) {
      return NextResponse.json({ error: 'That person is already a workspace member.' }, { status: 409 })
    }

    const now = new Date()
    const pending = await db.workspaceInvitation.findFirst({
      where: {
        workspaceId: context.workspaceId,
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    })
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const invitation = pending
      ? await db.workspaceInvitation.update({
          where: { id: pending.id },
          data: { role, tokenHash, invitedByUserId: context.userId, expiresAt, createdAt: now },
        })
      : await db.workspaceInvitation.create({
          data: {
            workspaceId: context.workspaceId,
            email,
            role,
            tokenHash,
            invitedByUserId: context.userId,
            expiresAt,
          },
        })

    const inviteUrl = new URL('/auth/accept-invite', request.url)
    inviteUrl.hash = 'token=' + encodeURIComponent(token)
    return NextResponse.json(
      { invitation: publicInvitation(invitation), inviteUrl: inviteUrl.toString() },
      { status: pending ? 200 : 201 },
    )
  },
  { writeRole: 'admin' },
)

export const DELETE = withWorkspace(
  async (request: NextRequest) => {
    const context = currentWorkspaceContext()
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Invitation id is required.' }, { status: 400 })

    const invitation = await db.workspaceInvitation.findFirst({
      where: { id, workspaceId: context.workspaceId },
      select: { id: true, revokedAt: true, acceptedAt: true },
    })
    if (!invitation) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 })
    if (invitation.acceptedAt) {
      return NextResponse.json({ error: 'This invitation was accepted. Remove the workspace member instead.' }, { status: 409 })
    }
    if (!invitation.revokedAt) {
      await db.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { revokedAt: new Date() },
      })
    }
    return NextResponse.json({ ok: true })
  },
  { writeRole: 'admin' },
)
