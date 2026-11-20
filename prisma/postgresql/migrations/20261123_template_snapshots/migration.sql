-- Enhanced reusable templates: full wizard snapshot, identifying image,
-- category and quick-reference sender fields. Idempotent so it is safe to
-- run more than once (Vercel also self-heals these columns on first API use).
ALTER TABLE "EmailTemplate" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'General';
ALTER TABLE "EmailTemplate" ADD COLUMN IF NOT EXISTS "plainText" TEXT;
ALTER TABLE "EmailTemplate" ADD COLUMN IF NOT EXISTS "snapshot" TEXT;
ALTER TABLE "EmailTemplate" ADD COLUMN IF NOT EXISTS "imageData" TEXT;
ALTER TABLE "EmailTemplate" ADD COLUMN IF NOT EXISTS "imageLabel" TEXT;
ALTER TABLE "EmailTemplate" ADD COLUMN IF NOT EXISTS "fromName" TEXT;
ALTER TABLE "EmailTemplate" ADD COLUMN IF NOT EXISTS "fromEmail" TEXT;
ALTER TABLE "EmailTemplate" ADD COLUMN IF NOT EXISTS "providerType" TEXT;

CREATE INDEX IF NOT EXISTS "EmailTemplate_workspaceId_category_idx" ON "EmailTemplate"("workspaceId", "category");
