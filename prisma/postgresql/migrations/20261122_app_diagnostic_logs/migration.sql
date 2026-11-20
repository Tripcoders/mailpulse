-- Application-wide diagnostic log (not tied to a campaign session).
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
);

CREATE INDEX IF NOT EXISTS "AppLog_workspaceId_createdAt_idx" ON "AppLog"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "AppLog_createdAt_idx" ON "AppLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AppLog_level_createdAt_idx" ON "AppLog"("level", "createdAt");
