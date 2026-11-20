import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withWorkspace } from '@/lib/workspace-context'
import { currentWorkspaceContext } from '@/lib/workspace-store'

export const runtime = 'nodejs'

export const GET = withWorkspace(async (_request: NextRequest) => {
  const context = currentWorkspaceContext()
  const memberships = await db.workspaceMember.findMany({
    where: { userId: context.userId },
    include: {
      workspace: {
        select: { id: true, name: true, slug: true, status: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({
    currentWorkspaceId: context.workspaceId,
    workspaces: memberships
      .filter((membership) => membership.workspace.status === 'active')
      .map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
        role: membership.role,
      })),
  })
})
