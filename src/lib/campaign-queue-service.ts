import { db } from '@/lib/db'
import { currentWorkspaceContext } from '@/lib/workspace-store'
import { decryptSecret, encryptSecret, hasStableEncryptionKey } from '@/lib/crypto'
import { normalizeSmtpPassword, resolveSmtpSettings } from '@/lib/smtp'
import { createCampaignRunId, enqueueCampaignBatch } from '@/lib/campaign-queue'
import type { ProviderType } from '@/lib/types'

const TEMPORARY_CREDENTIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000

type QueueStartOptions = { resendFailedRecipients?: boolean }

export class CampaignStartError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'CampaignStartError'
    this.status = status
  }
}

export type CampaignSmtpInput = {
  profileId?: unknown
  smtpUser?: unknown
  smtpPass?: unknown
}

type ResolvedCredential = {
  smtpUser: string
  smtpPass: string
  persistTemporary: boolean
  profileId?: string
}

export async function logCampaign(
  sessionId: string,
  level: string,
  message: string,
  recipient?: string,
) {
  try {
    await db.sendLog.create({
      data: {
        sessionId,
        level,
        message: message.slice(0, 4000),
        recipient: recipient || null,
      },
    })
  } catch (error) {
    console.error('Campaign log write failed:', error instanceof Error ? error.name : 'UnknownError')
  }
}

async function resolveCredential(session: any, input?: CampaignSmtpInput): Promise<ResolvedCredential> {
  if (!hasStableEncryptionKey()) {
    throw new CampaignStartError(
      'SMTP credential encryption is not configured. Add a stable SECRET_KEY of at least 32 characters to the MailPulse app, then redeploy.',
      503,
    )
  }

  const profileId = typeof input?.profileId === 'string' ? input.profileId.trim() : ''
  if (profileId) {
    const profile = await db.smtpProfile.findUnique({ where: { id: profileId } })
    if (!profile) throw new CampaignStartError('Saved sender not found in this workspace.', 404)
    const smtpPass = decryptSecret(profile.smtpPassEnc)
    if (!smtpPass) {
      throw new CampaignStartError('The saved SMTP password could not be decrypted. Save the sender again, then retry.', 409)
    }
    return { smtpUser: profile.smtpUser, smtpPass, persistTemporary: true, profileId: profile.id }
  }

  const suppliedUser = typeof input?.smtpUser === 'string' ? input.smtpUser.trim() : ''
  const suppliedPass = typeof input?.smtpPass === 'string' ? input.smtpPass : ''
  if (Boolean(suppliedUser) !== Boolean(suppliedPass)) {
    throw new CampaignStartError('Enter both the SMTP username and app password.')
  }
  if (suppliedUser && suppliedPass) {
    if (suppliedUser.length > 254 || suppliedPass.length > 1024) {
      throw new CampaignStartError('The SMTP username or password is longer than supported.')
    }
    const smtpPass = normalizeSmtpPassword(session.providerType as ProviderType, suppliedPass, session.smtpHost)
    if (!smtpPass) throw new CampaignStartError('Enter the SMTP password or app password.')
    return { smtpUser: suppliedUser, smtpPass, persistTemporary: true }
  }

  const saved = await db.campaignSmtpCredential.findUnique({ where: { sessionId: session.id } })
  if (!saved) {
    throw new CampaignStartError('This campaign needs SMTP credentials. Re-enter the SMTP username and app password to retry.', 409)
  }
  if (saved.expiresAt.getTime() <= Date.now()) {
    throw new CampaignStartError('The campaign temporary SMTP credentials expired after seven days. Enter the sender credentials again to retry.', 410)
  }

  const smtpPass = decryptSecret(saved.smtpPassEnc)
  if (!smtpPass) {
    throw new CampaignStartError('The campaign SMTP credentials could not be decrypted. Enter the sender credentials again to retry.', 409)
  }
  return { smtpUser: saved.smtpUser, smtpPass, persistTemporary: false }
}

async function persistTemporaryCredential(sessionId: string, credentials: ResolvedCredential) {
  if (!credentials.persistTemporary) return
  const workspaceId = currentWorkspaceContext().workspaceId
  const expiresAt = new Date(Date.now() + TEMPORARY_CREDENTIAL_TTL_MS)
  await db.campaignSmtpCredential.upsert({
    where: { sessionId },
    create: {
      sessionId,
      workspaceId,
      smtpUser: credentials.smtpUser,
      smtpPassEnc: encryptSecret(credentials.smtpPass),
      expiresAt,
    },
    update: {
      smtpUser: credentials.smtpUser,
      smtpPassEnc: encryptSecret(credentials.smtpPass),
      expiresAt,
    },
  })
}

export async function startQueuedCampaign(
  sessionId: string,
  input?: CampaignSmtpInput,
  options: QueueStartOptions = {},
) {
  const context = currentWorkspaceContext()
  const retryFailed = options.resendFailedRecipients === true
  const session = await db.emailSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new CampaignStartError('Campaign not found.', 404)
  if (session.deletedAt) throw new CampaignStartError('Restore this campaign before starting it.', 409)
  if (session.status === 'queued' || session.status === 'running') {
    if (retryFailed) throw new CampaignStartError('This campaign is already active.', 409)
    return { ok: true, sessionId, status: session.status, alreadyRunning: true }
  }

  const [pendingCount, failedCount] = await Promise.all([
    db.emailRecipient.count({ where: { sessionId, status: 'pending' } }),
    retryFailed ? db.emailRecipient.count({ where: { sessionId, status: 'failed' } }) : Promise.resolve(0),
  ])
  if (retryFailed && failedCount === 0) {
    throw new CampaignStartError('There are no failed recipients to retry.', 409)
  }
  if (pendingCount + failedCount === 0) {
    throw new CampaignStartError('There are no pending recipients.', 409)
  }

  const missingAttachment = await db.attachment.findFirst({
    where: { sessionId, content: null },
    select: { filename: true },
  })
  if (missingAttachment) {
    throw new CampaignStartError(
      'Attachment "' + missingAttachment.filename + '" is not stored in Neon. Upload it again before sending this campaign.',
      409,
    )
  }

  if (session.providerType === 'smtp' && !session.smtpHost) {
    throw new CampaignStartError('Enter the SMTP hostname for this custom provider.', 400)
  }

  const credentials = await resolveCredential(session, input)
  try {
    resolveSmtpSettings(
      session.providerType as ProviderType,
      credentials.smtpUser,
      session.smtpHost,
      session.smtpPort,
      session.smtpSecure,
    )
  } catch (error) {
    throw new CampaignStartError(error instanceof Error ? error.message : 'Check the SMTP provider settings.', 400)
  }
  await persistTemporaryCredential(sessionId, credentials)
  if (credentials.profileId) {
    await db.smtpProfile.update({ where: { id: credentials.profileId }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }
  await db.campaignSmtpCredential.deleteMany({ where: { expiresAt: { lt: new Date() } } })

  const runId = createCampaignRunId()
  const now = new Date()
  const queuedCount = await db.$transaction(async (tx) => {
    const current = await tx.emailSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, deletedAt: true, startedAt: true },
    })
    if (!current) throw new CampaignStartError('Campaign not found.', 404)
    if (current.deletedAt) throw new CampaignStartError('Restore this campaign before starting it.', 409)
    if (current.status === 'queued' || current.status === 'running') {
      throw new CampaignStartError('This campaign is already active.', 409)
    }

    if (retryFailed) {
      const retried = await tx.emailRecipient.updateMany({
        where: { sessionId, status: 'failed' },
        data: { status: 'pending', error: null, claimToken: null },
      })
      if (retried.count === 0) throw new CampaignStartError('There are no failed recipients to retry.', 409)
    }

    const counts = await tx.emailRecipient.groupBy({
      by: ['status'],
      where: { sessionId },
      _count: { _all: true },
    })
    const countByStatus = new Map<string, number>(
      counts.map((item): [string, number] => [item.status, item._count._all]),
    )
    const pending = countByStatus.get('pending') || 0
    if (pending === 0) throw new CampaignStartError('There are no pending recipients to send.', 409)

    const updated = await tx.emailSession.updateMany({
      where: {
        id: sessionId,
        workspaceId: context.workspaceId,
        deletedAt: null,
        status: current.status,
      },
      data: {
        status: 'queued',
        queueRunId: runId,
        queueBatch: 0,
        sentCount: countByStatus.get('sent') || 0,
        failedCount: countByStatus.get('failed') || 0,
        pendingCount: pending,
        startedAt: current.startedAt || now,
        completedAt: null,
      },
    })
    if (updated.count !== 1) {
      throw new CampaignStartError('Campaign state changed while it was starting. Refresh and try again.', 409)
    }
    return pending
  })

  await logCampaign(
    sessionId,
    'info',
    retryFailed
      ? 'Retry queued for ' + queuedCount + ' pending or failed recipient(s). SMTP will be verified before the first delivery.'
      : 'Campaign queued for ' + queuedCount + ' recipient(s). SMTP will be verified before the first delivery.',
  )

  try {
    await enqueueCampaignBatch({
      workspaceId: context.workspaceId,
      sessionId,
      runId,
      batchIndex: 0,
    })
  } catch (error) {
    await db.emailSession.updateMany({
      where: { id: sessionId, queueRunId: runId, status: 'queued' },
      data: { status: 'failed', completedAt: new Date() },
    })
    await logCampaign(
      sessionId,
      'error',
      'The queue handoff could not be confirmed. Check campaign progress before retrying because delivery may be uncertain.',
    )
    console.error('Campaign queue handoff failed:', error instanceof Error ? error.name : 'UnknownError')
    throw new CampaignStartError(
      'The campaign was saved, but the background queue did not confirm startup. Check campaign progress before retrying.',
      503,
    )
  }

  return { ok: true, sessionId, status: 'queued', alreadyRunning: false, recipientCount: queuedCount }
}
