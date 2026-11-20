import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { currentWorkspaceContext } from '@/lib/workspace-store'
import { withWorkspace } from '@/lib/workspace-context'

export const runtime = 'nodejs'

const editableRoles = ['owner', 'admin', 'sender', 'viewer'] as const
type EditableRole = (typeof editableRoles)[number]

function isEditableRole(role: unknown): role is EditableRole {
  return typeof role === 'string' && editableRoles.includes(role as EditableRole)
}

function canManageRole(actorRole: string, targetRole: string, nextRole?: string) {
  if (actorRole === 'owner') return true
  return (
    actorRole === 'admin' &&
    ['sender', 'viewer'].includes(targetRole) &&
    (nextRole === undefined || ['sender', 'viewer'].includes(nextRole))
  )
}

export const GET = withWorkspace(
  async () => {
    const context = currentWorkspaceContext()
    const members = await db.workspaceMember.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, userId: true, email: true, role: true, createdAt: true },
    })
    return NextResponse.json({
      members: members.map((member) => ({
        id: member.id,
        email: member.email,
        role: member.role,
        createdAt: member.createdAt,
        isCurrentUser: member.userId === context.userId,
      })),
    })
  },
  { readRole: 'admin' },
)

export const PATCH = withWorkspace(
  async (request: NextRequest) => {
    const context = currentWorkspaceContext()
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
    }

    const id = typeof body.id === 'string' ? body.id : ''
    const role = body.role
    if (!id || !isEditableRole(role)) {
      return NextResponse.json({ error: 'Member id and a valid role are required.' }, { status: 400 })
    }

    const member = await db.workspaceMember.findFirst({
      where: { id, workspaceId: context.workspaceId },
    })
    if (!member) return NextResponse.json({ error: 'Workspace member not found.' }, { status: 404 })
    if (member.userId === context.userId) {
      return NextResponse.json({ error: 'Ask another workspace owner to change your own role.' }, { status: 409 })
    }
    if (!canManageRole(context.role, member.role, role)) {
      return NextResponse.json({ error: 'Your workspace role cannot make this membership change.' }, { status: 403 })
    }
    if (member.role === role) return NextResponse.json({ ok: true, role })

    try {
      await db.$transaction(
        async (tx) => {
          if (member.role === 'owner' && role !== 'owner') {
            const owners = await tx.workspaceMember.count({
              where: { workspaceId: context.workspaceId, role: 'owner' },
            })
            if (owners <= 1) throw new Error('LAST_WORKSPACE_OWNER')
          }
          await tx.workspaceMember.update({ where: { id }, data: { role } })
        },
        { isolationLevel: 'Serializable' },
      )
      return NextResponse.json({ ok: true, role })
    } catch (error) {
      if (error instanceof Error && error.message === 'LAST_WORKSPACE_OWNER') {
        return NextResponse.json({ error: 'A workspace must keep at least one owner.' }, { status: 409 })
      }
      if ((error as { code?: string })?.code === 'P2034') {
        return NextResponse.json({ error: 'Membership changed at the same time. Refresh and try again.' }, { status: 409 })
      }
      throw error
    }
  },
  { writeRole: 'admin' },
)

export const DELETE = withWorkspace(
  async (request: NextRequest) => {
    const context = currentWorkspaceContext()
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Member id is required.' }, { status: 400 })

    const member = await db.workspaceMember.findFirst({
      where: { id, workspaceId: context.workspaceId },
    })
    if (!member) return NextResponse.json({ error: 'Workspace member not found.' }, { status: 404 })
    if (member.userId === context.userId) {
      return NextResponse.json({ error: 'Ask another workspace owner to remove your own membership.' }, { status: 409 })
    }
    if (!canManageRole(context.role, member.role)) {
      return NextResponse.json({ error: 'Your workspace role cannot remove this member.' }, { status: 403 })
    }

    try {
      await db.$transaction(
        async (tx) => {
          if (member.role === 'owner') {
            const owners = await tx.workspaceMember.count({
              where: { workspaceId: context.workspaceId, role: 'owner' },
            })
            if (owners <= 1) throw new Error('LAST_WORKSPACE_OWNER')
          }
          await tx.workspaceMember.delete({ where: { id } })
        },
        { isolationLevel: 'Serializable' },
      )
      return NextResponse.json({ ok: true })
    } catch (error) {
      if (error instanceof Error && error.message === 'LAST_WORKSPACE_OWNER') {
        return NextResponse.json({ error: 'A workspace must keep at least one owner.' }, { status: 409 })
      }
      if ((error as { code?: string })?.code === 'P2034') {
        return NextResponse.json({ error: 'Membership changed at the same time. Refresh and try again.' }, { status: 409 })
      }
      throw error
    }
  },
  { writeRole: 'admin' },
)
