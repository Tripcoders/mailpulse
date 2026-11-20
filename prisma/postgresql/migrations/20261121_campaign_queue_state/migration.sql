-- Persist queue ownership per campaign and hold non-remembered SMTP credentials
-- encrypted for a bounded retry window. Queue messages carry only campaign IDs.
ALTER TABLE "EmailSession"
  ADD COLUMN "queueRunId" TEXT,
  ADD COLUMN "queueBatch" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "CampaignSmtpCredential" (
  "sessionId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "smtpUser" TEXT NOT NULL,
  "smtpPassEnc" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignSmtpCredential_pkey" PRIMARY KEY ("sessionId")
);

CREATE INDEX "CampaignSmtpCredential_workspaceId_expiresAt_idx"
  ON "CampaignSmtpCredential"("workspaceId", "expiresAt");

CREATE UNIQUE INDEX "CampaignSmtpCredential_sessionId_workspaceId_key"
  ON "CampaignSmtpCredential"("sessionId", "workspaceId");

ALTER TABLE "CampaignSmtpCredential"
  ADD CONSTRAINT "CampaignSmtpCredential_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CampaignSmtpCredential"
  ADD CONSTRAINT "CampaignSmtpCredential_sessionId_workspaceId_fkey"
  FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "EmailSession"("id", "workspaceId")
  ON DELETE CASCADE ON UPDATE CASCADE;
