import { randomUUID } from 'node:crypto'
import { send } from '@vercel/queue'
import { db } from '@/lib/db'

export const CAMPAIGN_QUEUE_TOPIC = 'mailpulse-campaign-send'
const MAX_QUEUE_DELAY_SECONDS = 6 * 24 * 60 * 60

export type CampaignQueueMessage = {
  workspaceId: string
  sessionId: string
  runId: string
  batchIndex: number
}

export function isVercelCampaignQueueEnabled() {
  return process.env.VERCEL === '1' || Boolean(process.env.VERCEL_URL || process.env.VERCEL_ENV)
}

export async function hasCampaignQueueSchema() {
  const rows = await db.$queryRaw<Array<{
    queueRunId: boolean
    queueBatch: boolean
    claimToken: boolean
    workerLease: boolean
    credentialTable: boolean
    credentialWorkspace: boolean
  }>>`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'EmailSession' AND column_name = 'queueRunId'
      ) AS "queueRunId",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'EmailSession' AND column_name = 'queueBatch'
      ) AS "queueBatch",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'EmailRecipient' AND column_name = 'claimToken'
      ) AS "claimToken",
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'WorkerLease'
      ) AS "workerLease",
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'CampaignSmtpCredential'
      ) AS "credentialTable",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'CampaignSmtpCredential' AND column_name = 'workspaceId'
      ) AS "credentialWorkspace"
  `
  const schema = rows[0]
  return Boolean(
    schema?.queueRunId && schema.queueBatch && schema.claimToken &&
    schema.workerLease && schema.credentialTable && schema.credentialWorkspace,
  )
}

export function createCampaignRunId() {
  return randomUUID()
}

export async function enqueueCampaignBatch(message: CampaignQueueMessage, delayMs = 0) {
  const delaySeconds = Math.ceil(Math.max(0, delayMs) / 1000)
  if (delaySeconds > MAX_QUEUE_DELAY_SECONDS) {
    throw new Error('The campaign delay exceeds the six-day queue limit. Choose a shorter send delay.')
  }

  return send(CAMPAIGN_QUEUE_TOPIC, message, {
    idempotencyKey: `${message.sessionId}:${message.runId}:${message.batchIndex}`,
    retentionSeconds: 7 * 24 * 60 * 60,
    ...(delaySeconds > 0 ? { delaySeconds } : {}),
  })
}
