-- Baseline for the current Neon PostgreSQL schema. Compare before marking this applied to an existing database.
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "EmailSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "category" TEXT NOT NULL DEFAULT 'General',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalEmails" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "plainText" TEXT,
    "signatureText" TEXT,
    "signatureImage" TEXT,
    "batchSize" INTEGER NOT NULL DEFAULT 10,
    "batchDelayMs" INTEGER NOT NULL DEFAULT 2000,
    "perEmailDelayMs" INTEGER NOT NULL DEFAULT 500,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailRecipient" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "signatureText" TEXT,
    "signatureImage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "recipient" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SendLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmtpProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN,
    "smtpUser" TEXT NOT NULL,
    "smtpPassEnc" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmtpProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WizardDraft" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WizardDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailSession_status_idx" ON "EmailSession"("status");

-- CreateIndex
CREATE INDEX "EmailSession_createdAt_idx" ON "EmailSession"("createdAt");

-- CreateIndex
CREATE INDEX "EmailSession_deletedAt_idx" ON "EmailSession"("deletedAt");

-- CreateIndex
CREATE INDEX "EmailRecipient_sessionId_idx" ON "EmailRecipient"("sessionId");

-- CreateIndex
CREATE INDEX "EmailRecipient_sessionId_status_idx" ON "EmailRecipient"("sessionId", "status");

-- CreateIndex
CREATE INDEX "Attachment_sessionId_idx" ON "Attachment"("sessionId");

-- CreateIndex
CREATE INDEX "SendLog_sessionId_idx" ON "SendLog"("sessionId");

-- CreateIndex
CREATE INDEX "SendLog_sessionId_createdAt_idx" ON "SendLog"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SmtpProfile_smtpUser_key" ON "SmtpProfile"("smtpUser");

-- AddForeignKey
ALTER TABLE "EmailRecipient" ADD CONSTRAINT "EmailRecipient_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EmailSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EmailSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendLog" ADD CONSTRAINT "SendLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EmailSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
