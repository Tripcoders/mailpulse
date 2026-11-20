import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { runWithWorkspace, type WorkspaceContext } from '@/lib/workspace-store'
import { decryptSecret, hasStableEncryptionKey } from '@/lib/crypto'
import { smtpVerificationError } from '@/lib/smtp'
import { buildCampaignMessage, createCampaignTransporter, type CampaignMailSettings } from '@/lib/campaign-smtp'
import { enqueueCampaignBatch, type CampaignQueueMessage } from '@/lib/campaign-queue'
import { logCampaign } from '@/lib/campaign-queue-service'
import { describeError, logDiagnostic } from '@/lib/diagnostic-logger'

const LEASE_MS = 6 * 60 * 1000
const STALE_CLAIM_MS = 6 * 60 * 1000
const MAX_FUNCTION_WORK_MS = 4 * 60 * 1000
const MAX_SINGLE_EMAIL_BUDGET_MS = 200_000
const MAX_INLINE_DELAY_MS = 5_000
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [2_000, 10_000]
const MAX_CONSECUTIVE_FAILURES = 5
const TRANSIENT_ERROR = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ESOCKET|EPIPE|timeout|temporar|rate.?limit|greylist|421|451|defer/i
const UNKNOWN_DELIVERY = 'Delivery outcome is unknown after the sender stopped. Check the recipient mailbox before resending.'

type QueueRecipient = { id: string; email: string; name: string }

class PermanentCampaignError extends Error {}

function isQueueMessage(value: unknown): value is CampaignQueueMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<CampaignQueueMessage>
  return typeof message.workspaceId === 'string' &&
    typeof message.sessionId === 'string' &&
    typeof message.runId === 'string' &&
    Number.isInteger(message.batchIndex) && Number(message.batchIndex) >= 0
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readError(error: unknown) {
  const detail = error as { message?: unknown; code?: unknown; responseCode?: unknown; command?: unknown }
  return {
    message: String(detail?.message || 'Unknown SMTP error').slice(0, 1000),
    code: String(detail?.code || ''),
    responseCode: Number(detail?.responseCode || 0),
    command: String(detail?.command || '').trim().toUpperCase(),
  }
}

function isAuthFailure(error: unknown) {
  const detail = readError(error)
  return detail.code === 'EAUTH' || detail.responseCode === 535
}

function isTransientSmtpError(error: unknown) {
  const detail = readError(error)
  return TRANSIENT_ERROR.test([detail.code, detail.responseCode, detail.message].join(' '))
}

function isAmbiguousDataFailure(error: unknown) {
  const detail = readError(error)
  return detail.command === 'DATA' && detail.responseCode === 0
}

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizedSmtpError(error: unknown, smtpPass: string) {
  const detail = readError(error)
  return smtpPass
    ? detail.message.replace(new RegExp(escapeForRegExp(smtpPass), 'g'), '[redacted]').slice(0, 1000)
    : detail.message
}

async function acquireLease(sessionId: string, ownerId: string) {
  const leaseId = `campaign:${sessionId}`
  const rows = await db.$queryRaw<Array<{ ownerId: string }>>`
    INSERT INTO "WorkerLease" ("id", "ownerId", "leaseExpiresAt", "updatedAt")
    VALUES (${leaseId}, ${ownerId}, CURRENT_TIMESTAMP + INTERVAL '6 minutes', CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE
    SET "ownerId" = EXCLUDED."ownerId",
        "leaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '6 minutes',
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "WorkerLease"."ownerId" = EXCLUDED."ownerId"
       OR "WorkerLease"."leaseExpiresAt" <= CURRENT_TIMESTAMP
    RETURNING "ownerId"
  `
  return rows[0]?.ownerId === ownerId ? leaseId : null
}

async function releaseLease(leaseId: string, ownerId: string) {
  await db.$executeRaw`
    DELETE FROM "WorkerLease" WHERE "id" = ${leaseId} AND "ownerId" = ${ownerId}
  `
}

async function recoverStaleClaims(sessionId: string) {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS)
  const stale = await db.emailRecipient.findMany({
    where: { sessionId, status: 'sending', updatedAt: { lt: staleBefore } },
    select: { id: true, email: true, claimToken: true },
  })

  let recovered = 0
  for (const recipient of stale) {
    const result = await db.$transaction(async (tx) => {
      const changed = await tx.emailRecipient.updateMany({
        where: {
          id: recipient.id,
          sessionId,
          status: 'sending',
          claimToken: recipient.claimToken,
          updatedAt: { lt: staleBefore },
        },
        data: { status: 'failed', error: UNKNOWN_DELIVERY, claimToken: null },
      })
      if (changed.count !== 1) return false
      await tx.emailSession.update({
        where: { id: sessionId },
        data: { failedCount: { increment: 1 }, pendingCount: { decrement: 1 } },
      })
      return true
    })
    if (result) {
      recovered += 1
      await logCampaign(
        sessionId,
        'warn',
        `Delivery for ${recipient.email} was in flight when the sender stopped. Check the mailbox before retrying.`,
        recipient.email,
      )
    }
  }
  return recovered
}

async function loadCampaignSmtpCredentials(session: any) {
  if (!hasStableEncryptionKey()) {
    throw new PermanentCampaignError('The stable SMTP encryption key is missing from the Vercel environment.')
  }
  const stored = await db.campaignSmtpCredential.findUnique({ where: { sessionId: session.id } })
  if (!stored) throw new PermanentCampaignError('Campaign SMTP credentials are missing. Restart the campaign with a saved sender or new credentials.')
  if (stored.expiresAt.getTime() <= Date.now()) {
    throw new PermanentCampaignError('The campaign’s temporary SMTP credentials expired. Restart with a saved sender or enter the credentials again.')
  }
  const smtpPass = decryptSecret(stored.smtpPassEnc)
  if (!smtpPass) throw new PermanentCampaignError('Campaign SMTP credentials could not be decrypted. Restart with the sender credentials again.')
  return { smtpUser: stored.smtpUser, smtpPass }
}

async function loadAttachments(sessionId: string) {
  const rows = await db.attachment.findMany({
    where: { sessionId },
    select: { filename: true, mimetype: true, content: true },
  })
  const missing = rows.find((file) => !file.content)
  if (missing) throw new PermanentCampaignError(`Attachment “${missing.filename}” is not available in Neon storage.`)
  return rows.map((file) => ({
    filename: file.filename,
    content: Buffer.from(file.content as Uint8Array),
    contentType: file.mimetype,
  }))
}

async function failCampaignSetup(sessionId: string, runId: string, message: string) {
  await db.emailSession.updateMany({
    where: { id: sessionId, queueRunId: runId, status: { in: ['queued', 'running'] } },
    data: { status: 'failed', completedAt: new Date() },
  })
  await logCampaign(sessionId, 'error', message)
}

async function deliverRecipient(
  session: CampaignMailSettings & { id: string },
  recipient: QueueRecipient,
  smtpPass: string,
  transporter: ReturnType<typeof createCampaignTransporter>['transporter'],
  attachments: Array<{ filename: string; content: Buffer; contentType: string }>,
) {
  const claimToken = randomUUID()
  const claimed = await db.emailRecipient.updateMany({
    where: { id: recipient.id, sessionId: session.id, status: 'pending' },
    data: { status: 'sending', claimToken, attemptCount: { increment: 1 }, error: null },
  })
  if (claimed.count !== 1) return { status: 'skipped' as const, authFailure: false }

  await logCampaign(
    session.id,
    'info',
    `Sending to ${recipient.name ? recipient.name + ' ' : ''}<${recipient.email}>...`,
    recipient.email,
  )

  let lastError: unknown = null
  let deliveryOutcomeUnknown = false
  let info: { messageId?: string } | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      const retryClaim = await db.emailRecipient.updateMany({
        where: { id: recipient.id, sessionId: session.id, status: 'sending', claimToken },
        data: { attemptCount: { increment: 1 } },
      })
      if (retryClaim.count !== 1) return { status: 'skipped' as const, authFailure: false }
    }

    try {
      info = await transporter.sendMail({
        ...buildCampaignMessage(session, recipient),
        attachments,
      })
      break
    } catch (error) {
      lastError = error
      if (isAmbiguousDataFailure(error)) {
        deliveryOutcomeUnknown = true
        break
      }
      if (isTransientSmtpError(error) && attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]
        await logCampaign(session.id, 'warn', `Temporary SMTP error for ${recipient.email}; retrying in ${delay / 1000}s.`, recipient.email)
        await sleep(delay)
        continue
      }
      break
    }
  }

  if (info) {
    const recorded = await db.$transaction(async (tx) => {
      const updated = await tx.emailRecipient.updateMany({
        where: { id: recipient.id, sessionId: session.id, status: 'sending', claimToken },
        data: { status: 'sent', sentAt: new Date(), error: null, claimToken: null },
      })
      if (updated.count !== 1) return false
      await tx.emailSession.update({
        where: { id: session.id },
        data: { sentCount: { increment: 1 }, pendingCount: { decrement: 1 } },
      })
      return true
    })
    if (!recorded) {
      await logCampaign(session.id, 'warn', `SMTP accepted ${recipient.email}, but its delivery record could not be claimed. Check the mailbox before resending.`, recipient.email)
      return { status: 'unknown' as const, authFailure: false }
    }

    const messageId = info.messageId ? String(info.messageId).slice(0, 24) : 'n/a'
    await logCampaign(session.id, 'success', `Delivered to ${recipient.email} (ID: ${messageId}).`, recipient.email)
    return { status: 'sent' as const, authFailure: false }
  }

  const errorMessage = deliveryOutcomeUnknown ? UNKNOWN_DELIVERY : sanitizedSmtpError(lastError, smtpPass)
  const recordedFailure = await db.$transaction(async (tx) => {
    const updated = await tx.emailRecipient.updateMany({
      where: { id: recipient.id, sessionId: session.id, status: 'sending', claimToken },
      data: { status: 'failed', error: errorMessage, claimToken: null },
    })
    if (updated.count !== 1) return false
    await tx.emailSession.update({
      where: { id: session.id },
      data: { failedCount: { increment: 1 }, pendingCount: { decrement: 1 } },
    })
    return true
  })
  if (recordedFailure) {
    await logCampaign(
      session.id,
      deliveryOutcomeUnknown ? 'warn' : 'error',
      deliveryOutcomeUnknown
        ? `SMTP ended during DATA for ${recipient.email}; delivery outcome is unknown. Check the mailbox before retrying.`
        : `Failed for ${recipient.email}: ${errorMessage}`,
      recipient.email,
    )
  }
  return { status: recordedFailure ? 'failed' as const : 'skipped' as const, authFailure: isAuthFailure(lastError) }
}

async function processCampaignMessage(message: CampaignQueueMessage) {
  const workspace = await db.workspace.findUnique({
    where: { id: message.workspaceId },
    select: { id: true, slug: true, name: true, status: true },
  })
  if (!workspace || workspace.status !== 'active') return

  const context: WorkspaceContext = {
    userId: 'vercel-queue-worker',
    email: 'queue-worker@system.invalid',
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    workspaceName: workspace.name,
    role: 'owner',
  }

  await runWithWorkspace(context, async () => {
    let session = await db.emailSession.findUnique({ where: { id: message.sessionId } })
    if (!session || session.workspaceId !== workspace.id) return
    if (session.queueRunId !== message.runId || !['queued', 'running'].includes(session.status)) return

    if (message.batchIndex < session.queueBatch) {
      await enqueueCampaignBatch({ ...message, batchIndex: session.queueBatch })
      return
    }
    if (message.batchIndex > session.queueBatch) throw new Error('Campaign queue batch arrived out of order.')

    const ownerId = randomUUID()
    const leaseId = await acquireLease(session.id, ownerId)
    if (!leaseId) throw new Error('Another delivery invocation owns this campaign. Vercel Queues will retry it.')

    try {
      session = await db.emailSession.findUnique({ where: { id: message.sessionId } })
      if (!session || session.queueRunId !== message.runId || !['queued', 'running'].includes(session.status)) return
      if (session.queueBatch !== message.batchIndex) {
        if (session.queueBatch > message.batchIndex) {
          await enqueueCampaignBatch({ ...message, batchIndex: session.queueBatch })
          return
        }
        throw new Error('Campaign queue state is ahead of the database batch counter.')
      }

      await db.emailSession.updateMany({
        where: { id: session.id, queueRunId: message.runId, status: 'queued' },
        data: { status: 'running' },
      })

      await recoverStaleClaims(session.id)

      let credentials: { smtpUser: string; smtpPass: string }
      let attachments: Array<{ filename: string; content: Buffer; contentType: string }>
      try {
        credentials = await loadCampaignSmtpCredentials(session)
        attachments = await loadAttachments(session.id)
      } catch (error) {
        if (!(error instanceof PermanentCampaignError)) throw error
        await failCampaignSetup(session.id, message.runId, error.message)
        return
      }

      const { transporter, host, port } = createCampaignTransporter(session, credentials.smtpUser, credentials.smtpPass)
      let consecutiveFailures = 0
      let autoPaused = false
      let processedCount = 0
      let deferredDelayMs = 0
      const deadline = Date.now() + MAX_FUNCTION_WORK_MS
      const requestedBatchSize = Math.max(1, Math.min(100, Number(session.batchSize) || 10))
      const batch = await db.emailRecipient.findMany({
        where: { sessionId: session.id, status: 'pending' },
        take: requestedBatchSize,
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true, name: true },
      })

      if (batch.length > 0) {
        await logCampaign(session.id, 'info', `Processing a durable batch of up to ${batch.length} recipient(s).`)
      }

      try {
        if (message.batchIndex === 0) {
          try {
            await transporter.verify()
          } catch (error) {
            if (isTransientSmtpError(error)) throw error
            await failCampaignSetup(
              session.id,
              message.runId,
              'SMTP verification failed: ' + smtpVerificationError(error, host, port),
            )
            return
          }
        }

        for (let index = 0; index < batch.length; index += 1) {
          const current = await db.emailSession.findUnique({
            where: { id: session.id },
            select: { status: true, queueRunId: true },
          })
          if (!current || current.queueRunId !== message.runId || current.status !== 'running') break

          const perEmailDelayMs = Math.max(0, Number(session.perEmailDelayMs) || 0)
          if (index > 0 && perEmailDelayMs > 0) {
            const available = deadline - Date.now()
            if (perEmailDelayMs > MAX_INLINE_DELAY_MS || available < perEmailDelayMs + MAX_SINGLE_EMAIL_BUDGET_MS) {
              deferredDelayMs = perEmailDelayMs
              break
            }
            await sleep(perEmailDelayMs)
          }
          if (deadline - Date.now() < MAX_SINGLE_EMAIL_BUDGET_MS) {
            deferredDelayMs = processedCount > 0 ? Math.max(1_000, perEmailDelayMs) : 0
            break
          }

          const outcome = await deliverRecipient(session, batch[index], credentials.smtpPass, transporter, attachments)
          if (outcome.status !== 'skipped') processedCount += 1
          if (outcome.status === 'sent') consecutiveFailures = 0
          if (outcome.status === 'failed') {
            consecutiveFailures += 1
            if (outcome.authFailure || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              await db.emailSession.updateMany({
                where: { id: session.id, queueRunId: message.runId, status: 'running' },
                data: { status: 'paused' },
              })
              await logCampaign(
                session.id,
                'warn',
                outcome.authFailure
                  ? 'Campaign auto-paused after SMTP authentication failed. Fix or update the sender credentials, then resume.'
                  : `Campaign auto-paused after ${MAX_CONSECUTIVE_FAILURES} consecutive delivery failures. Review the SMTP provider limits before resuming.`,
              )
              autoPaused = true
              break
            }
          }
        }
      } finally {
        transporter.close()
      }

      if (autoPaused) return

      const latest = await db.emailSession.findUnique({ where: { id: session.id } })
      if (!latest || latest.queueRunId !== message.runId || !['queued', 'running'].includes(latest.status)) return

      const pending = await db.emailRecipient.count({ where: { sessionId: session.id, status: 'pending' } })
      const sending = await db.emailRecipient.count({ where: { sessionId: session.id, status: 'sending' } })
      if (pending === 0 && sending > 0) {
        throw new Error('Campaign recipients are still in flight; retry after the delivery visibility timeout.')
      }
      if (pending === 0 && sending === 0) {
        const finalStatus = latest.sentCount > 0 ? 'completed' : 'failed'
        const finished = await db.emailSession.updateMany({
          where: { id: session.id, queueRunId: message.runId, status: { in: ['queued', 'running'] } },
          data: { status: finalStatus, completedAt: new Date(), pendingCount: 0 },
        })
        if (finished.count === 1) {
          await logCampaign(session.id, 'success', `Campaign finished. Sent: ${latest.sentCount} | Failed: ${latest.failedCount}.`)
          if (latest.failedCount === 0) {
            await db.campaignSmtpCredential.deleteMany({ where: { sessionId: session.id } })
          }
        }
        return
      }

      const nextBatch = message.batchIndex + 1
      const advanced = await db.emailSession.updateMany({
        where: {
          id: session.id,
          queueRunId: message.runId,
          queueBatch: message.batchIndex,
          status: { in: ['queued', 'running'] },
        },
        data: { queueBatch: nextBatch, status: 'running' },
      })
      if (advanced.count !== 1) return

      const completedConfiguredBatch = batch.length === requestedBatchSize && processedCount === batch.length
      const continuationDelay = completedConfiguredBatch
        ? Math.max(0, Number(session.batchDelayMs) || 0)
        : deferredDelayMs

      await enqueueCampaignBatch({ ...message, batchIndex: nextBatch }, continuationDelay)
    } finally {
      await releaseLease(leaseId, ownerId)
    }
  })
}

export async function handleCampaignQueueMessage(message: unknown) {
  if (!isQueueMessage(message)) {
    console.error('Discarded malformed campaign queue message.')
    await logDiagnostic({
      event: 'queue_message_malformed',
      message: 'Discarded a malformed campaign queue message.',
      detail: JSON.stringify(message)?.slice(0, 4000),
      level: 'error',
      source: 'queue',
    })
    return
  }
  try {
    await processCampaignMessage(message)
  } catch (error) {
    const { message: errorMessage, detail } = describeError(error)
    await logDiagnostic({
      event: 'queue_worker_crashed',
      message: `Queue worker failed for session ${message.sessionId}: ${errorMessage}`,
      detail,
      level: 'error',
      source: 'queue',
      workspaceId: message.workspaceId,
      path: '/api/queues/campaign-send',
    })
    throw error // let Vercel Queues retry
  }
}
