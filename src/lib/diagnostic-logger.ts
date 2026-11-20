import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'

export type DiagnosticLevel = 'error' | 'warn' | 'info'

export interface DiagnosticInput {
  event: string
  message: string
  detail?: string | null
  level?: DiagnosticLevel
  source?: string
  workspaceId?: string | null
  path?: string | null
  method?: string | null
  status?: number | null
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS "AppLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'server',
    "level" TEXT NOT NULL DEFAULT 'error',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "path" TEXT,
    "method" TEXT,
    "status" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppLog_pkey" PRIMARY KEY ("id")
  )
`

let tableReady: Promise<void> | null = null

// Self-heals on Vercel: the table is created on first use even if the
// migration has not been applied to the Neon branch yet.
export function ensureDiagnosticTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await db.$executeRawUnsafe(CREATE_TABLE_SQL)
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AppLog_workspaceId_createdAt_idx" ON "AppLog"("workspaceId", "createdAt")').catch(() => {})
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AppLog_createdAt_idx" ON "AppLog"("createdAt")').catch(() => {})
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AppLog_level_createdAt_idx" ON "AppLog"("level", "createdAt")').catch(() => {})
    })().catch((error) => {
      tableReady = null // allow a retry on the next call
      throw error
    })
  }
  return tableReady
}

function clip(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null
  const str = String(value)
  return str.length > max ? `${str.slice(0, max)}\n…[truncated]` : str
}

export function describeError(error: unknown, fallback = 'Unknown error'): { message: string; detail: string } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || fallback,
      detail: `${error.name}: ${error.message}\n${error.stack || '(no stack available)'}`,
    }
  }
  const message = clip(error, 500) || fallback
  return { message, detail: message }
}

/**
 * Persist a diagnostic entry. Never throws — logging must never break a request.
 */
export async function logDiagnostic(input: DiagnosticInput): Promise<void> {
  try {
    await ensureDiagnosticTable()
    await db.$executeRawUnsafe(
      `INSERT INTO "AppLog"
        ("id", "workspaceId", "source", "level", "event", "message", "detail", "path", "method", "status", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      randomUUID(),
      input.workspaceId ?? null,
      clip(input.source ?? 'server', 32) ?? 'server',
      clip(input.level ?? 'error', 16) ?? 'error',
      clip(input.event, 120) ?? 'event',
      clip(input.message, 4000) ?? '',
      clip(input.detail, 30000),
      clip(input.path, 500),
      clip(input.method, 16),
      Number.isFinite(input.status ?? NaN) ? input.status : null,
    )
  } catch {
    // Intentionally swallowed: diagnostics are best-effort.
  }
}

/** Fire-and-forget variant for hot paths. */
export function recordDiagnostic(input: DiagnosticInput): void {
  void logDiagnostic(input)
}
