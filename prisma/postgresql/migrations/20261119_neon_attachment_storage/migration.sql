-- Store uploaded files in Neon so the web app and sender worker share durable attachment bytes.
ALTER TABLE "Attachment" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "Attachment" ALTER COLUMN "filepath" DROP NOT NULL;
ALTER TABLE "Attachment" ADD COLUMN "content" BYTEA;
ALTER TABLE "Attachment" ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "Attachment_workspaceId_expiresAt_idx"
  ON "Attachment"("workspaceId", "expiresAt");
