-- Create workspace ownership tables before backfilling existing data.
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'sender',
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Workspace" ("id", "name", "slug", "status", "createdAt", "updatedAt")
VALUES ('mailpulse-bootstrap', 'MailPulse', 'mailpulse', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Replace globally unique keys with workspace-scoped uniqueness.
ALTER TABLE "EmailRecipient" DROP CONSTRAINT "EmailRecipient_sessionId_fkey";
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_sessionId_fkey";
ALTER TABLE "SendLog" DROP CONSTRAINT "SendLog_sessionId_fkey";
DROP INDEX "Setting_key_key";
DROP INDEX "SmtpProfile_smtpUser_key";

-- Add tenant keys as nullable columns, then backfill every existing record.
ALTER TABLE "EmailSession" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "EmailRecipient" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Signature" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "EmailTemplate" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "SendLog" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Setting" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "SmtpProfile" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "WizardDraft" ADD COLUMN "workspaceId" TEXT;

UPDATE "EmailSession" SET "workspaceId" = 'mailpulse-bootstrap' WHERE "workspaceId" IS NULL;
UPDATE "EmailRecipient" SET "workspaceId" = 'mailpulse-bootstrap' WHERE "workspaceId" IS NULL;
UPDATE "Attachment" SET "workspaceId" = 'mailpulse-bootstrap' WHERE "workspaceId" IS NULL;
UPDATE "Signature" SET "workspaceId" = 'mailpulse-bootstrap' WHERE "workspaceId" IS NULL;
UPDATE "EmailTemplate" SET "workspaceId" = 'mailpulse-bootstrap' WHERE "workspaceId" IS NULL;
UPDATE "SendLog" SET "workspaceId" = 'mailpulse-bootstrap' WHERE "workspaceId" IS NULL;
UPDATE "Setting" SET "workspaceId" = 'mailpulse-bootstrap' WHERE "workspaceId" IS NULL;
UPDATE "SmtpProfile" SET "workspaceId" = 'mailpulse-bootstrap' WHERE "workspaceId" IS NULL;
UPDATE "WizardDraft" SET "workspaceId" = 'mailpulse-bootstrap' WHERE "workspaceId" IS NULL;
UPDATE "WizardDraft" SET "id" = 'mailpulse-bootstrap:' || "id" WHERE "id" = 'main';

ALTER TABLE "EmailSession" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "EmailRecipient" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Attachment" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Signature" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "EmailTemplate" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "SendLog" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Setting" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "SmtpProfile" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "WizardDraft" ALTER COLUMN "workspaceId" SET NOT NULL;

CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE INDEX "WorkspaceMember_workspaceId_role_idx" ON "WorkspaceMember"("workspaceId", "role");
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_email_key" ON "WorkspaceMember"("workspaceId", "email");
CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");
CREATE INDEX "WorkspaceInvitation_workspaceId_email_expiresAt_idx" ON "WorkspaceInvitation"("workspaceId", "email", "expiresAt");
CREATE INDEX "EmailSession_workspaceId_status_idx" ON "EmailSession"("workspaceId", "status");
CREATE UNIQUE INDEX "EmailSession_id_workspaceId_key" ON "EmailSession"("id", "workspaceId");
CREATE INDEX "EmailRecipient_workspaceId_status_idx" ON "EmailRecipient"("workspaceId", "status");
CREATE INDEX "Attachment_workspaceId_idx" ON "Attachment"("workspaceId");
CREATE INDEX "Signature_workspaceId_createdAt_idx" ON "Signature"("workspaceId", "createdAt");
CREATE INDEX "EmailTemplate_workspaceId_updatedAt_idx" ON "EmailTemplate"("workspaceId", "updatedAt");
CREATE INDEX "SendLog_workspaceId_createdAt_idx" ON "SendLog"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "Setting_workspaceId_key_key" ON "Setting"("workspaceId", "key");
CREATE INDEX "SmtpProfile_workspaceId_isDefault_idx" ON "SmtpProfile"("workspaceId", "isDefault");
CREATE UNIQUE INDEX "SmtpProfile_workspaceId_smtpUser_key" ON "SmtpProfile"("workspaceId", "smtpUser");
CREATE INDEX "WizardDraft_workspaceId_updatedAt_idx" ON "WizardDraft"("workspaceId", "updatedAt");

ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailSession" ADD CONSTRAINT "EmailSession_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailRecipient" ADD CONSTRAINT "EmailRecipient_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailRecipient" ADD CONSTRAINT "EmailRecipient_sessionId_workspaceId_fkey"
  FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "EmailSession"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_sessionId_workspaceId_fkey"
  FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "EmailSession"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SendLog" ADD CONSTRAINT "SendLog_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SendLog" ADD CONSTRAINT "SendLog_sessionId_workspaceId_fkey"
  FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "EmailSession"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmtpProfile" ADD CONSTRAINT "SmtpProfile_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WizardDraft" ADD CONSTRAINT "WizardDraft_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
