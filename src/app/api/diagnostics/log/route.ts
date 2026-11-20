import { NextRequest, NextResponse } from 'next/server'
import { logDiagnostic, type DiagnosticLevel } from '@/lib/diagnostic-logger'
import { withWorkspace } from '@/lib/workspace-context'
import { currentWorkspaceContext } from '@/lib/workspace-store'

export const runtime = 'nodejs'

const ALLOWED_LEVELS: DiagnosticLevel[] = ['error', 'warn', 'info']

// POST /api/diagnostics/log — browser-side failures (fetch errors, uncaught
// exceptions, campaign launch failures) are persisted here for review.
export const POST = withWorkspace(async (req: NextRequest) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 })
  }

  const event = typeof body.event === 'string' ? body.event.slice(0, 120) : ''
  const message = typeof body.message === 'string' ? body.message.slice(0, 4000) : ''
  if (!event || !message) {
    return NextResponse.json({ ok: false, error: 'event and message are required.' }, { status: 400 })
  }

  const level = ALLOWED_LEVELS.includes(body.level as DiagnosticLevel)
    ? (body.level as DiagnosticLevel)
    : 'error'
  const workspaceId = currentWorkspaceContext().workspaceId

  await logDiagnostic({
    event,
    message,
    detail: typeof body.detail === 'string' ? body.detail.slice(0, 30000) : null,
    level,
    source: 'client',
    workspaceId,
    path: typeof body.path === 'string' ? body.path.slice(0, 500) : null,
    method: typeof body.method === 'string' ? body.method.slice(0, 16) : null,
    status: typeof body.status === 'number' ? body.status : null,
  })

  return NextResponse.json({ ok: true })
})
