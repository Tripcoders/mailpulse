import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureDiagnosticTable } from '@/lib/diagnostic-logger'
import { withWorkspace } from '@/lib/workspace-context'
import { currentWorkspaceContext } from '@/lib/workspace-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface DiagnosticLogEntry {
  id: string
  workspaceId: string | null
  source: string
  level: string
  event: string
  message: string
  detail: string | null
  path: string | null
  method: string | null
  status: number | null
  createdAt: string
}

// GET /api/diagnostics/logs?limit=500&level=error
export const GET = withWorkspace(async (req: NextRequest) => {
  const url = new URL(req.url)
  const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') || '500')))
  const level = url.searchParams.get('level')?.trim().toLowerCase() || ''
  const since = url.searchParams.get('since')

  try {
    await ensureDiagnosticTable()
  } catch {
    return NextResponse.json({ logs: [], error: 'Diagnostic log table is not available yet.' }, { status: 503 })
  }

  const workspaceId = currentWorkspaceContext().workspaceId
  const conditions = ['("workspaceId" = $1 OR "workspaceId" IS NULL)']
  const values: unknown[] = [workspaceId]

  if (level && ['error', 'warn', 'info'].includes(level)) {
    values.push(level)
    conditions.push(`"level" = $${values.length}`)
  }
  if (since) {
    const parsed = new Date(since)
    if (!Number.isNaN(parsed.getTime())) {
      values.push(parsed.toISOString())
      conditions.push(`"createdAt" >= $${values.length}`)
    }
  }
  values.push(limit)
  const limitParam = `$${values.length}`

  const rows = await db.$queryRawUnsafe(
    `SELECT "id", "workspaceId", "source", "level", "event", "message", "detail", "path", "method", "status", "createdAt"
     FROM "AppLog"
     WHERE ${conditions.join(' AND ')}
     ORDER BY "createdAt" DESC
     LIMIT ${limitParam}`,
    ...values,
  ) as DiagnosticLogEntry[]

  const logs = rows.map((row) => ({
    ...row,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date(row.createdAt).toISOString(),
  }))
  return NextResponse.json({ logs })
})
