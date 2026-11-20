import { db } from '@/lib/db'

// Vercel runs `prisma generate` at build time but does not apply migrations.
// Reusable templates need their new columns at runtime, so the API heals the
// table on first use. ADD COLUMN IF NOT EXISTS makes this idempotent and safe
// to call from every serverless instance.
const COLUMNS = [
  ['category', `TEXT NOT NULL DEFAULT 'General'`],
  ['plainText', 'TEXT'],
  ['snapshot', 'TEXT'],
  ['imageData', 'TEXT'],
  ['imageLabel', 'TEXT'],
  ['fromName', 'TEXT'],
  ['fromEmail', 'TEXT'],
  ['providerType', 'TEXT'],
] as const

let ready: Promise<void> | null = null

export function ensureTemplateSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      for (const [name, definition] of COLUMNS) {
        await db.$executeRawUnsafe(`ALTER TABLE "EmailTemplate" ADD COLUMN IF NOT EXISTS "${name}" ${definition}`)
      }
      await db.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "EmailTemplate_workspaceId_category_idx" ON "EmailTemplate"("workspaceId", "category")',
      ).catch(() => {})
    })().catch((error) => {
      ready = null // retry on the next request
      throw error
    })
  }
  return ready
}
