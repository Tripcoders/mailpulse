import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSessionSocketToken, getEngineApiToken } from '@/lib/engine-auth'
import { withWorkspace } from '@/lib/workspace-context'
import { currentWorkspaceContext } from '@/lib/workspace-store'

export const runtime = 'nodejs'

export const GET = withWorkspace(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  if (!getEngineApiToken()) {
    return NextResponse.json({ error: 'The send engine is not configured.' }, { status: 503 })
  }

  const { id } = await params
  const session = await db.emailSession.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!session) return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 })

  const context = currentWorkspaceContext()
  const token = createSessionSocketToken({
    sessionId: session.id,
    workspaceId: context.workspaceId,
    userId: context.userId,
  })
  if (!token) return NextResponse.json({ error: 'The send engine is not configured.' }, { status: 503 })

  return NextResponse.json({ token, expiresIn: 180 }, { headers: { 'Cache-Control': 'no-store' } })
})
