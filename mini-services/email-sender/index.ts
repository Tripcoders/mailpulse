import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'
import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'

// ─────────────────────────────────────────────────────────────
// Prisma client (shared DB with Next.js app)
// The DATABASE IS THE SOURCE OF TRUTH for send state: every
// recipient row is claimed (sending) before delivery and marked sent/failed
// atomically afterwards. SMTP cannot guarantee exactly-once delivery, so
// interrupted in-flight recipients are flagged for review instead of resent.
// ─────────────────────────────────────────────────────────────
const db = new PrismaClient({
  log: ['error', 'warn'],
})
const legacyUploadRoot = resolve(process.env.UPLOAD_DIR || join(process.cwd(), 'upload'))

function getLegacyAttachmentPath(filepath: string | null) {
  if (!filepath) return null
  const target = resolve(filepath)
  const relativePath = relative(legacyUploadRoot, target)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return null
  return target
}

// ─────────────────────────────────────────────────────────────
// In-memory session runtime (SMTP credentials are NOT persisted)
// ─────────────────────────────────────────────────────────────
interface SessionRuntime {
  sessionId: string
  smtpUser: string
  smtpPass: string
  transporter: Transporter
  running: boolean
  paused: boolean
  cancelled: boolean
  leaseLost: boolean
  consecutiveFailures: number
}

const runtimes = new Map<string, SessionRuntime>()
const sessionWorkspaceIds = new Map<string, string>()
const ENGINE_API_TOKEN = process.env.ENGINE_API_TOKEN?.trim() || ''
const WORKER_INSTANCE_ID = randomUUID()
const WORKER_LEASE_ID = 'email-sender'
const WORKER_LEASE_HEARTBEAT_MS = 10_000
const isPostgresDatabase = /^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL?.trim() || '')
let workerLeaseHeld = false
let workerLeaseHeartbeat: ReturnType<typeof setInterval> | null = null
let workerLeaseHeartbeatInFlight = false
let recoveryState: 'starting' | 'ready' | 'degraded' = 'starting'
let recoveryInFlight = false
let recoveryRetryTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRecoveryRetry(delayMs: number) {
  if (recoveryRetryTimer) return
  recoveryRetryTimer = setTimeout(() => {
    recoveryRetryTimer = null
    void recoverOnBoot()
  }, delayMs)
  recoveryRetryTimer.unref?.()
}

async function acquireWorkerLease() {
  if (!isPostgresDatabase) {
    workerLeaseHeld = true
    return true
  }

  const rows = await db.$queryRaw<Array<{ ownerId: string }>>`
    INSERT INTO "WorkerLease" ("id", "ownerId", "leaseExpiresAt", "updatedAt")
    VALUES (
      ${WORKER_LEASE_ID},
      ${WORKER_INSTANCE_ID},
      CURRENT_TIMESTAMP + INTERVAL '45 seconds',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO UPDATE
    SET "ownerId" = EXCLUDED."ownerId",
        "leaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '45 seconds',
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "WorkerLease"."ownerId" = EXCLUDED."ownerId"
       OR "WorkerLease"."leaseExpiresAt" <= CURRENT_TIMESTAMP
    RETURNING "ownerId"
  `
  workerLeaseHeld = rows[0]?.ownerId === WORKER_INSTANCE_ID
  return workerLeaseHeld
}

function loseWorkerLease(reason: string) {
  if (!workerLeaseHeld) return
  workerLeaseHeld = false
  recoveryState = 'degraded'
  if (workerLeaseHeartbeat) {
    clearInterval(workerLeaseHeartbeat)
    workerLeaseHeartbeat = null
  }

  for (const [sessionId, runtime] of runtimes) {
    runtime.leaseLost = true
    runtime.cancelled = true
    runtime.paused = false
    runtime.running = false
    try { runtime.transporter.close() } catch { /* transport may already be closed */ }
    runtimes.delete(sessionId)
  }
  console.error('Sender lease lost; this instance is stopping campaign work:', reason)
  scheduleRecoveryRetry(5000)
}

async function renewWorkerLease() {
  if (!workerLeaseHeld || !isPostgresDatabase) return
  try {
    const renewed = await db.$executeRaw`
      UPDATE "WorkerLease"
      SET "leaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '45 seconds',
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${WORKER_LEASE_ID}
        AND "ownerId" = ${WORKER_INSTANCE_ID}
        AND "leaseExpiresAt" > CURRENT_TIMESTAMP
    `
    if (renewed !== 1) loseWorkerLease('another sender instance owns the lease')
  } catch (error) {
    loseWorkerLease(error instanceof Error ? error.name : 'database unavailable')
  }
}

function startWorkerLeaseHeartbeat() {
  if (!isPostgresDatabase || workerLeaseHeartbeat) return
  workerLeaseHeartbeat = setInterval(() => {
    if (workerLeaseHeartbeatInFlight) return
    workerLeaseHeartbeatInFlight = true
    void renewWorkerLease().finally(() => { workerLeaseHeartbeatInFlight = false })
  }, WORKER_LEASE_HEARTBEAT_MS)
  workerLeaseHeartbeat.unref?.()
}

function secureTokenEquals(expected: string, actual: string) {
  if (!expected || !actual) return false
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}

function readBearerToken(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return ''
  return value.slice('Bearer '.length).trim()
}

function verifySessionSocketToken(token: string) {
  if (!ENGINE_API_TOKEN || token.length > 4096) return null
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) return null

  const expected = createHmac('sha256', ENGINE_API_TOKEN).update(encoded).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (
      payload?.iss !== 'mailpulse-web' ||
      payload?.aud !== 'mailpulse-engine' ||
      payload?.purpose !== 'session-read' ||
      typeof payload?.sid !== 'string' ||
      typeof payload?.wid !== 'string' ||
      typeof payload?.uid !== 'string' ||
      typeof payload?.exp !== 'number' ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null
    }
    return payload as { sid: string; wid: string; uid: string; exp: number }
  } catch {
    return null
  }
}

function isAllowedBrowserOrigin(origin: string | undefined) {
  if (!origin) return true
  const configured = (process.env.APP_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (configured.includes(origin)) return true
  if (process.env.NODE_ENV !== 'production') {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  }
  return false
}

// Delivery retry policy: transient errors are retried with backoff.
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [2000, 5000]
const FAILURE_SPIKE_LIMIT = 5 // auto-pause after N consecutive failures

const TRANSIENT_RE = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|esocket|EPIPE|timeout|temporar|rate.?limit|greylist|421|451|deferr/i

// ─────────────────────────────────────────────────────────────
// One HTTP server for everything: socket.io on /socket.io plus the
// HTTP control plane (/health, /control/*) on the same port. This works on a
// persistent single-instance host and keeps the health check reachable.
// ─────────────────────────────────────────────────────────────
const httpServer = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const writeOk = (data: any = { ok: true }, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  const writeErr = (msg: string, code = 400) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: msg }))
  }
  const pathname = new URL(req.url || '/', 'http://localhost').pathname

  try {
    if (req.method === 'GET' && pathname === '/health') {
      let database: 'ok' | 'down' | 'misconfigured' = 'ok'
      if (process.env.NODE_ENV === 'production' && !isPostgresDatabase) {
        database = 'misconfigured'
      } else {
        try {
          await db.$queryRawUnsafe('SELECT 1')
        } catch {
          database = 'down'
        }
      }
      const ready =
        database === 'ok' &&
        recoveryState === 'ready' &&
        workerLeaseHeld &&
        !!ENGINE_API_TOKEN
      return writeOk(
        {
          ok: ready,
          database,
          recovery: recoveryState,
          lease: workerLeaseHeld ? 'held' : 'waiting',
          controlAuth: ENGINE_API_TOKEN ? 'ok' : 'missing',
          uptime: Math.round(process.uptime()),
          runtimeSessions: runtimes.size,
        },
        ready ? 200 : 503,
      )
    }

    if (req.method === 'POST' && pathname.startsWith('/control/')) {
      if (!secureTokenEquals(ENGINE_API_TOKEN, readBearerToken(req.headers.authorization))) {
        return writeErr('Unauthorized', 401)
      }
      if (recoveryState !== 'ready' || !workerLeaseHeld) {
        return writeErr('Sender is not ready to accept campaign controls.', 503)
      }

      const body = await new Promise<string>((resolve, reject) => {
        let data = ''; req.on('data', (c: any) => (data += c)); req.on('end', () => resolve(data || '{}')); req.on('error', reject)
        setTimeout(() => reject(new Error('body timeout')), 5000)
      })
      const payload = JSON.parse(body)

      if (pathname === '/control/start') {
        if (!payload?.sessionId || !payload?.smtpUser || !payload?.smtpPass) return writeErr('sessionId, smtpUser and smtpPass are required', 400)
        void startSession(payload).catch((e) => console.error('start error:', e))
        return writeOk({ ok: true, accepted: true }, 202)
      }
      if (pathname === '/control/pause') { pauseSession(payload.sessionId); return writeOk() }
      if (pathname === '/control/resume') {
        void resumeSession(payload.sessionId).catch((e) => console.error('resume error:', e))
        return writeOk({ ok: true, accepted: true }, 202)
      }
      if (pathname === '/control/cancel') { cancelSession(payload.sessionId); return writeOk() }
      if (pathname === '/control/resend') {
        void resendFailed(payload.sessionId).catch((e) => console.error('resend error:', e))
        return writeOk({ ok: true, accepted: true }, 202)
      }
    }
  } catch (e: any) {
    return writeErr(e?.message || 'Engine error', 500)
  }
  return writeErr('Not found', 404)
})

const SOCKET_PATH = process.env.SOCKET_PATH || '/socket.io'
const io = new Server(httpServer, {
  path: SOCKET_PATH,
  cors: {
    origin: (origin, callback) => callback(null, isAllowedBrowserOrigin(origin)),
    methods: ['GET', 'POST'],
  },
  allowRequest: (request, callback) => {
    callback(null, isAllowedBrowserOrigin(request.headers.origin))
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.use((socket, next) => {
  const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : ''
  if (secureTokenEquals(ENGINE_API_TOKEN, token)) {
    socket.data.isService = true
    return next()
  }

  const claims = verifySessionSocketToken(token)
  if (!claims) return next(new Error('Unauthorized'))
  Promise.all([
    db.emailSession.findUnique({
      where: { id: claims.sid },
      select: { workspaceId: true },
    }),
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: claims.wid, userId: claims.uid } },
      select: { workspaceId: true, workspace: { select: { status: true } } },
    }),
  ]).then(([session, membership]) => {
    if (
      claims.exp <= Math.floor(Date.now() / 1000) ||
      !session ||
      session.workspaceId !== claims.wid ||
      !membership ||
      membership.workspaceId !== claims.wid ||
      membership.workspace.status !== 'active'
    ) {
      return next(new Error('Unauthorized'))
    }
    socket.data.isService = false
    socket.data.sessionId = claims.sid
    socket.data.workspaceId = claims.wid
    socket.data.userId = claims.uid
    socket.data.tokenExpiresAt = claims.exp * 1000
    next()
  }).catch(() => next(new Error('Unauthorized')))
})

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
async function getSessionWorkspaceId(sessionId: string) {
  const known = sessionWorkspaceIds.get(sessionId)
  if (known) return known
  const session = await db.emailSession.findUnique({
    where: { id: sessionId },
    select: { workspaceId: true },
  })
  if (!session?.workspaceId) return null
  sessionWorkspaceIds.set(sessionId, session.workspaceId)
  return session.workspaceId
}

function log(sessionId: string, level: string, message: string, recipient?: string) {
  const entry = { level, message, recipient, timestamp: new Date().toISOString() }
  void getSessionWorkspaceId(sessionId)
    .then((workspaceId) => {
      if (!workspaceId) return
      return db.sendLog.create({
        data: { sessionId, workspaceId, level, message, recipient: recipient || null },
      })
    })
    .catch(() => {})
  io.to(`session:${sessionId}`).emit('log', entry)
  const prefix = level === 'error' ? '✖' : level === 'success' ? '✓' : level === 'warn' ? '!' : '›'
  console.log(`[${sessionId.slice(-6)}] ${prefix} ${message}`)
}

function emitProgress(sessionId: string) {
  db.emailSession
    .findUnique({
      where: { id: sessionId },
      select: {
        id: true, status: true, totalEmails: true, sentCount: true,
        failedCount: true, pendingCount: true, startedAt: true, completedAt: true,
      },
    })
    .then((session) => { if (session) io.to(`session:${sessionId}`).emit('progress', session) })
    .catch(() => {})
}

function buildTransporter(providerType: string, user: string, pass: string, smtpHost?: string | null, smtpPort?: number | null, smtpSecure?: boolean | null) {
  let host: string
  let port: number
  let secure: boolean

  // Auto-detect provider from email domain if providerType is 'smtp' but host is missing
  let resolvedType = providerType
  if (providerType === 'smtp' && !smtpHost) {
    const domain = user.split('@')[1]?.toLowerCase() || ''
    if (domain.includes('gmail')) resolvedType = 'gmail'
    else if (domain.includes('yahoo')) resolvedType = 'yahoo'
    else if (domain.includes('outlook') || domain.includes('hotmail') || domain.includes('live')) resolvedType = 'outlook'
    else if (domain.includes('icloud') || domain.includes('me.com')) resolvedType = 'icloud'
    else if (domain.includes('zoho')) resolvedType = 'zoho'
  }

  if (resolvedType === 'gmail') {
    host = 'smtp.gmail.com'; port = 465; secure = true
  } else if (resolvedType === 'yahoo') {
    host = 'smtp.mail.yahoo.com'; port = 465; secure = true
  } else if (resolvedType === 'outlook') {
    host = 'smtp.office365.com'; port = 587; secure = false
  } else if (resolvedType === 'icloud') {
    host = 'smtp.mail.me.com'; port = 587; secure = false
  } else if (resolvedType === 'zoho') {
    host = 'smtp.zoho.com'; port = 465; secure = true
  } else if (resolvedType === 'sendgrid') {
    host = 'smtp.sendgrid.net'; port = 587; secure = false
  } else if (resolvedType === 'mailgun') {
    host = 'smtp.mailgun.org'; port = 587; secure = false
  } else if (resolvedType === 'ses') {
    host = 'email-smtp.us-east-1.amazonaws.com'; port = 587; secure = false
  } else {
    if (!smtpHost) {
      throw new Error('SMTP host is required for custom SMTP provider. Please enter your SMTP server address (e.g., smtp.gmail.com).')
    }
    host = smtpHost
    port = smtpPort || 587
    secure = smtpSecure ?? false
  }
  return nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  })
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function personalize(text: string, recipient: { email: string; name: string }) {
  const name = recipient.name || recipient.email.split('@')[0]
  return text
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{email\}\}/g, recipient.email)
    .replace(/\{\{first_name\}\}/g, name.split(' ')[0])
}

function buildMessage(session: any, recipient: { email: string; name: string }) {
  const personalized = personalize(session.bodyHtml, recipient)
  const plainText = session.plainText || personalized.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  let html = personalized
  if (session.signatureText) {
    html += `\n<div style="margin-top:24px;font-size:14px;color:#475569;white-space:pre-wrap;border-top:1px solid #e2e8f0;padding-top:12px">${escapeHtml(session.signatureText)}</div>`
  }
  if (session.signatureImage) {
    html += `\n<div style="margin-top:12px"><img src="${session.signatureImage}" alt="signature" style="max-height:90px;max-width:320px"/></div>`
  }
  const subject = personalize(session.subject, recipient)
  const fromName = session.fromName || session.fromEmail.split('@')[0]
  const from = `"${fromName}" <${session.fromEmail}>`
  return {
    from,
    to: recipient.name ? `"${recipient.name}" <${recipient.email}>` : recipient.email,
    subject, html, text: plainText,
  }
}

async function getAttachments(sessionId: string) {
  const files = await db.attachment.findMany({ where: { sessionId } })
  const attachments: { filename: string; content: Buffer; contentType: string }[] = []
  for (const f of files) {
    if (f.content) {
      attachments.push({
        filename: f.filename,
        content: Buffer.from(f.content),
        contentType: f.mimetype,
      })
      continue
    }
    const safePath = getLegacyAttachmentPath(f.filepath)
    if (!safePath) {
      log(sessionId, 'warn', 'An attachment has no stored bytes and no safe legacy file path.')
      continue
    }
    try {
      const content = await readFile(safePath)
      attachments.push({ filename: f.filename, content, contentType: f.mimetype })
    } catch {
      log(sessionId, 'warn', 'Could not read attachment ' + f.filename)
    }
  }
  return attachments
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

const DELIVERY_OUTCOME_UNKNOWN =
  'Delivery outcome is unknown after the sender stopped. Check the recipient mailbox before resending.'

async function recoverInterruptedRecipients(sessionId?: string) {
  const inFlightSessions = await db.emailRecipient.findMany({
    where: sessionId ? { sessionId, status: 'sending' } : { status: 'sending' },
    select: { sessionId: true },
    distinct: ['sessionId'],
  })

  let recoveredCount = 0
  for (const inFlight of inFlightSessions) {
    const count = await db.$transaction(async (tx) => {
      const recovered = await tx.emailRecipient.updateMany({
        where: { sessionId: inFlight.sessionId, status: 'sending' },
        data: {
          status: 'failed',
          error: DELIVERY_OUTCOME_UNKNOWN,
          claimToken: null,
        },
      })
      if (recovered.count === 0) return 0

      const session = await tx.emailSession.findUnique({
        where: { id: inFlight.sessionId },
        select: { pendingCount: true },
      })
      if (!session) throw new Error('Interrupted campaign disappeared during recovery.')

      await tx.emailSession.update({
        where: { id: inFlight.sessionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          failedCount: { increment: recovered.count },
          pendingCount: Math.max(0, session.pendingCount - recovered.count),
        },
      })
      return recovered.count
    })

    if (count > 0) {
      recoveredCount += count
      log(
        inFlight.sessionId,
        'warn',
        `${count} recipient(s) were in flight when the sender stopped. Delivery is unknown; check their inboxes before retrying.`,
      )
    }
  }
  return recoveredCount
}

// ─────────────────────────────────────────────────────────────
// Boot recovery — crash/power-cut safe.
// 1. Pending rows remain resumable; in-flight outcomes are marked failed for
//    review because SMTP may have accepted a message before the process stopped.
// 2. Sessions left active without a runtime are marked failed so the user can
//    restart the remaining pending recipients with fresh credentials.
// ─────────────────────────────────────────────────────────────
async function recoverOnBoot(attempt = 1): Promise<void> {
  if (recoveryInFlight) return
  recoveryInFlight = true
  try {
    if (process.env.NODE_ENV === 'production' && !isPostgresDatabase) {
      recoveryState = 'degraded'
      console.error('Production sender requires a PostgreSQL DATABASE_URL.')
      scheduleRecoveryRetry(30000)
      return
    }

    let currentAttempt = attempt
    while (true) {
      try {
        // SQLite-specific pragmas (skip for PostgreSQL)
        if (process.env.DATABASE_URL?.startsWith('file:')) {
          try {
            await db.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
            await db.$queryRawUnsafe('PRAGMA busy_timeout=5000;')
          } catch { /* pragma failures are non-fatal */ }
        }

        if (!(await acquireWorkerLease())) {
          recoveryState = 'starting'
          console.log('Another sender instance owns the delivery lease; this instance will wait.')
          scheduleRecoveryRetry(WORKER_LEASE_HEARTBEAT_MS)
          return
        }
        startWorkerLeaseHeartbeat()

        const uncertainRecipients = await recoverInterruptedRecipients()

        const stale = await db.emailSession.findMany({
          where: { status: { in: ['running', 'paused', 'queued'] } },
        })
        for (const s of stale) {
          await db.emailSession.update({
            where: { id: s.id },
            data: { status: 'failed', completedAt: new Date() },
          })
          log(s.id, 'warn', `Service restarted while "${s.name}" was ${s.status}. ${s.pendingCount} recipient(s) remain queued. Restart with credentials to continue; in-flight recipients require delivery review.`)
        }

        if (!workerLeaseHeld) throw new Error('Sender lease was lost during startup recovery.')

        if (uncertainRecipients > 0 || stale.length > 0) {
          console.log(`🛠 Recovery: ${uncertainRecipients} in-flight recipient(s) marked for review, ${stale.length} stale session(s) marked for restart`)
        }
        recoveryState = 'ready'
        return
      } catch (e: any) {
        // A cold Neon database (or a sleeping free host) must not crash-loop
        // the engine. Keep HTTP health available and retry with backoff.
        if (currentAttempt >= 6) {
          recoveryState = 'degraded'
          console.error(`Boot recovery gave up after ${currentAttempt} attempts:`, e?.message || e)
          scheduleRecoveryRetry(30000)
          return
        }
        const delay = Math.min(30000, 2000 * currentAttempt)
        console.warn(`Boot recovery failed (attempt ${currentAttempt}) — retrying in ${delay}ms:`, e?.message || e)
        await sleep(delay)
        currentAttempt += 1
      }
    }
  } finally {
    recoveryInFlight = false
  }
}

// ─────────────────────────────────────────────────────────────
// Session lifecycle
// ─────────────────────────────────────────────────────────────
async function startSession(payload: { sessionId: string; smtpUser: string; smtpPass: string }) {
  const { sessionId, smtpUser, smtpPass } = payload
  if (!sessionId || !smtpUser || !smtpPass) throw new Error('sessionId, smtpUser and smtpPass are required')
  if (!workerLeaseHeld || recoveryState !== 'ready') throw new Error('The sender is not ready to start a campaign.')

  const existing = runtimes.get(sessionId)
  if (existing && existing.running) {
    log(sessionId, 'warn', 'Session is already running')
    return
  }

  await recoverInterruptedRecipients(sessionId)
  const session = await db.emailSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new Error('Session not found')
  sessionWorkspaceIds.set(sessionId, session.workspaceId)

  const transporter = buildTransporter(session.providerType, smtpUser, smtpPass, session.smtpHost, session.smtpPort, session.smtpSecure)
  const runtime: SessionRuntime = {
    sessionId, smtpUser, smtpPass, transporter,
    running: true, paused: false, cancelled: false,
    leaseLost: false,
    consecutiveFailures: 0,
  }
  runtimes.set(sessionId, runtime)

  await db.emailSession.update({ where: { id: sessionId }, data: { status: 'running', startedAt: new Date(), completedAt: null } })

  const pendingNow = await db.emailRecipient.count({ where: { sessionId, status: 'pending' } })
  log(sessionId, 'info', `Starting send session "${session.name}"`)
  log(sessionId, 'info', `Provider: ${session.providerType.toUpperCase()} | Sender: ${session.fromName} <${session.fromEmail}>`)
  if (session.sentCount > 0 && pendingNow < session.totalEmails) {
    log(sessionId, 'info', `Resuming — ${session.sentCount} already sent, ${pendingNow} still queued`)
  }
  log(sessionId, 'info', `Verifying SMTP connection for ${smtpUser}...`)

  try {
    await transporter.verify()
    log(sessionId, 'success', 'SMTP connection verified successfully')
  } catch (e: any) {
    log(sessionId, 'error', `SMTP verification failed: ${e.message}`)
    log(sessionId, 'warn', 'No emails were sent. Fix your credentials and use "Restart with credentials".')
    await db.emailSession.update({ where: { id: sessionId }, data: { status: 'failed', completedAt: new Date() } })
    emitProgress(sessionId)
    io.to(`session:${sessionId}`).emit('completed', { sessionId, sent: 0, failed: 0, total: session.totalEmails, error: true })
    runtimes.delete(sessionId)
    return
  }

  await runSendLoop(sessionId, runtime)
}

async function runSendLoop(sessionId: string, runtime: SessionRuntime) {
  try {
    await runSendLoopInternal(sessionId, runtime)
  } catch (error) {
    runtime.running = false
    runtime.paused = true
    if (runtimes.get(sessionId) === runtime) runtimes.delete(sessionId)
    try { runtime.transporter.close() } catch { /* transporter may already be closed */ }
    console.error(
      'Campaign processing stopped before progress could be saved:',
      error instanceof Error ? error.name : 'UnknownError',
    )

    if (workerLeaseHeld || !isPostgresDatabase) {
      try {
        await recoverInterruptedRecipients(sessionId)
        await db.emailSession.update({
          where: { id: sessionId },
          data: { status: 'failed', completedAt: new Date() },
        })
        log(
          sessionId,
          'error',
          'Campaign stopped because progress could not be saved. In-flight delivery outcomes need review before resending.',
        )
        emitProgress(sessionId)
      } catch {
        // The health endpoint remains down until the database can be reached.
      }
    }
    io.to(`session:${sessionId}`).emit('completed', { sessionId, error: true })
  }
}

async function runSendLoopInternal(sessionId: string, runtime: SessionRuntime) {
  const session = await db.emailSession.findUnique({ where: { id: sessionId } })
  if (!session) return

  const attachments = await getAttachments(sessionId)
  if (attachments.length > 0) log(sessionId, 'info', `Loaded ${attachments.length} attachment(s)`)

  log(sessionId, 'info', `Total recipients: ${session.totalEmails} | Batch size: ${session.batchSize} | Batch delay: ${session.batchDelayMs}ms`)

  while (!runtime.cancelled) {
    if (runtime.paused) { await sleep(500); continue }

    const batch = await db.emailRecipient.findMany({
      where: { sessionId, status: 'pending' },
      take: session.batchSize,
      orderBy: { createdAt: 'asc' },
    })
    if (batch.length === 0) break

    log(sessionId, 'info', `Processing batch of ${batch.length} email(s)...`)

    for (const recipient of batch) {
      if (runtime.cancelled) break
      while (runtime.paused && !runtime.cancelled) { await sleep(400) }
      if (runtime.cancelled) break

      await sendOne(sessionId, runtime, session, recipient, attachments)
      emitProgress(sessionId)
      if (runtime.consecutiveFailures >= FAILURE_SPIKE_LIMIT) {
        runtime.paused = true
        runtime.consecutiveFailures = 0
        log(sessionId, 'warn', 'Auto-paused after 5 consecutive failures — check your credentials/provider limits, then press Resume.')
        break
      }
      if (session.perEmailDelayMs > 0) await sleep(session.perEmailDelayMs)
    }
    if (runtime.cancelled || runtime.paused) break

    const remaining = await db.emailRecipient.count({ where: { sessionId, status: 'pending' } })
    if (remaining > 0 && session.batchDelayMs > 0) {
      log(sessionId, 'info', `Batch complete. ${remaining} remaining. Waiting ${session.batchDelayMs}ms before next batch...`)
      await sleep(session.batchDelayMs)
    }
  }

  if (runtime.leaseLost) return
  runtime.running = false
  if (runtime.paused && !runtime.cancelled) {
    await db.emailSession.update({
      where: { id: sessionId },
      data: { status: 'paused', completedAt: null },
    })
    emitProgress(sessionId)
    return
  }
  const finalSession = await db.emailSession.findUnique({ where: { id: sessionId } })
  if (finalSession && !runtime.cancelled) {
    const failed = finalSession.failedCount
    const sent = finalSession.sentCount
    const status = sent > 0 ? 'completed' : 'failed'
    await db.emailSession.update({ where: { id: sessionId }, data: { status, completedAt: new Date() } })
    log(sessionId, 'success', `Session finished. Sent: ${sent} | Failed: ${failed}`)
    io.to(`session:${sessionId}`).emit('completed', { sessionId, sent, failed, total: finalSession.totalEmails })
  } else if (runtime.cancelled) {
    await db.emailSession.update({ where: { id: sessionId }, data: { status: 'cancelled', completedAt: new Date() } })
    log(sessionId, 'warn', 'Session cancelled by user')
    io.to(`session:${sessionId}`).emit('cancelled', { sessionId })
  }
  emitProgress(sessionId)
  setTimeout(() => runtimes.delete(sessionId), 5 * 60 * 1000)
}

/**
 * One recipient = one claim → deliver with retries → terminal state.
 * Transient provider errors (timeouts, resets, rate limiting) are retried
 * with backoff; permanent errors fail immediately. attemptCount reflects
 * every delivery attempt, which powers UI honesty + provider protection.
 */
async function sendOne(
  sessionId: string, runtime: SessionRuntime, session: any,
  recipient: { id: string; email: string; name: string }, attachments: any[]
) {
  if (runtime.leaseLost || !workerLeaseHeld) throw new Error('The sender no longer owns the delivery lease.')

  const claimToken = randomUUID()
  const claimed = await db.emailRecipient.updateMany({
    where: { id: recipient.id, status: 'pending' },
    data: { status: 'sending', claimToken, attemptCount: { increment: 1 } },
  })
  if (claimed.count !== 1) return

  log(sessionId, 'info', `Sending to ${recipient.name ? recipient.name + ' ' : ''}<${recipient.email}>...`, recipient.email)

  let lastError: any = null
  let deliveryOutcomeUnknown = false
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (runtime.cancelled) {
      await db.emailRecipient.updateMany({
        where: { id: recipient.id, status: 'sending', claimToken },
        data: { status: 'pending', claimToken: null },
      })
      return
    }
    while (runtime.paused && !runtime.cancelled) { await sleep(400) }

    if (runtime.cancelled) {
      await db.emailRecipient.updateMany({
        where: { id: recipient.id, status: 'sending', claimToken },
        data: { status: 'pending', claimToken: null },
      })
      return
    }

    if (attempt > 1) {
      const retryClaim = await db.emailRecipient.updateMany({
        where: { id: recipient.id, status: 'sending', claimToken },
        data: { attemptCount: { increment: 1 } },
      })
      if (retryClaim.count !== 1) return
    }

    let info: any
    try {
      const msg = buildMessage(session, recipient)
      info = await runtime.transporter.sendMail({ ...msg, attachments })
    } catch (e: any) {
      lastError = e
      const hasSmtpResponse =
        e?.responseCode !== undefined &&
        e?.responseCode !== null &&
        Number.isFinite(Number(e.responseCode))
      if (String(e?.command || '').trim().toUpperCase() === 'DATA' && !hasSmtpResponse) {
        deliveryOutcomeUnknown = true
        break
      }
      const transient = TRANSIENT_RE.test(String(e?.message || ''))
      if (transient && attempt < MAX_ATTEMPTS && !runtime.cancelled) {
        const wait = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]
        log(sessionId, 'warn', `Transient error for ${recipient.email} (attempt ${attempt}) — retrying in ${wait / 1000}s: ${e.message}`, recipient.email)
        await sleep(wait)
        continue
      }
      break
    }

    const recorded = await db.$transaction(async (tx) => {
      const updated = await tx.emailRecipient.updateMany({
        where: { id: recipient.id, status: 'sending', claimToken },
        data: { status: 'sent', sentAt: new Date(), error: null, claimToken: null },
      })
      if (updated.count !== 1) return false
      await tx.emailSession.update({
        where: { id: sessionId },
        data: { sentCount: { increment: 1 }, pendingCount: { decrement: 1 } },
      })
      return true
    })
    if (!recorded) {
      log(
        sessionId,
        'warn',
        `SMTP accepted ${recipient.email}, but this worker no longer owns its delivery record. Check delivery before resending.`,
        recipient.email,
      )
      return
    }

    const mid = info.messageId ? String(info.messageId).slice(0, 24) : 'n/a'
    log(sessionId, 'success', `Delivered to ${recipient.email} (ID: ${mid})${attempt > 1 ? ` on retry ${attempt - 1}` : ''}`, recipient.email)
    runtime.consecutiveFailures = 0
    return
  }

  // Attempt budget exhausted → terminal failure
  const errorMessage = deliveryOutcomeUnknown
    ? DELIVERY_OUTCOME_UNKNOWN
    : String(lastError?.message || 'Unknown error').slice(0, 1000)
  const recordedFailure = await db.$transaction(async (tx) => {
    const updated = await tx.emailRecipient.updateMany({
      where: { id: recipient.id, status: 'sending', claimToken },
      data: { status: 'failed', error: errorMessage, claimToken: null },
    })
    if (updated.count !== 1) return false
    await tx.emailSession.update({
      where: { id: sessionId },
      data: { failedCount: { increment: 1 }, pendingCount: { decrement: 1 } },
    })
    return true
  })
  if (!recordedFailure) return

  const failureLog = deliveryOutcomeUnknown
    ? 'SMTP ended during DATA for ' + recipient.email + '; delivery outcome is unknown. Check the recipient mailbox before retrying.'
    : 'Failed for ' + recipient.email + ': ' + errorMessage
  log(sessionId, deliveryOutcomeUnknown ? 'warn' : 'error', failureLog, recipient.email)
  runtime.consecutiveFailures += 1
}

function pauseSession(sessionId: string) {
  const r = runtimes.get(sessionId)
  if (r && r.running) { r.paused = true; log(sessionId, 'warn', 'Session paused') }
}
async function resumeSession(sessionId: string) {
  const r = runtimes.get(sessionId)
  if (!r || r.leaseLost || !workerLeaseHeld || recoveryState !== 'ready') return
  if (r.running) {
    if (r.paused) {
      r.paused = false
      r.consecutiveFailures = 0
      log(sessionId, 'info', 'Session resumed')
    }
    return
  }
  if (!r.paused || r.cancelled) return

  r.running = true
  r.paused = false
  r.consecutiveFailures = 0
  try {
    await db.emailSession.update({
      where: { id: sessionId },
      data: { status: 'running', completedAt: null },
    })
    log(sessionId, 'info', 'Session resumed')
    await runSendLoop(sessionId, r)
  } catch (error) {
    r.running = false
    r.paused = true
    log(sessionId, 'error', 'Campaign could not resume because its state could not be saved.')
    console.error('resume error:', error instanceof Error ? error.name : 'UnknownError')
  }
}
function cancelSession(sessionId: string) {
  const r = runtimes.get(sessionId)
  if (r) { r.cancelled = true; r.paused = false; log(sessionId, 'warn', 'Cancellation requested...') }
}
async function resendFailed(sessionId: string) {
  const session = await db.emailSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new Error('Session not found')
  const r = runtimes.get(sessionId)
  if (!r) { log(sessionId, 'error', 'Cannot resend: session runtime expired. Re-start with credentials.'); return }
  if (r.running) { log(sessionId, 'warn', 'Session is already running.'); return }
  const requeued = await db.$transaction(async (tx) => {
    const unknownCount = await tx.emailRecipient.count({
      where: { sessionId, status: 'failed', error: DELIVERY_OUTCOME_UNKNOWN },
    })
    const changed = await tx.emailRecipient.updateMany({
      where: {
        sessionId,
        status: 'failed',
        OR: [
          { error: { not: DELIVERY_OUTCOME_UNKNOWN } },
          { error: null },
        ],
      },
      data: { status: 'pending', claimToken: null, error: null },
    })
    if (changed.count === 0) return { count: 0, unknownCount }

    const pendingCount = await tx.emailRecipient.count({ where: { sessionId, status: 'pending' } })
    const failedCount = await tx.emailRecipient.count({ where: { sessionId, status: 'failed' } })
    await tx.emailSession.update({
      where: { id: sessionId },
      data: { status: 'running', failedCount, pendingCount, completedAt: null },
    })
    return { count: changed.count, unknownCount }
  })
  if (requeued.unknownCount > 0) {
    log(
      sessionId,
      'warn',
      requeued.unknownCount + ' recipient(s) with unknown delivery outcomes were left for review and not resent.',
    )
  }
  if (requeued.count === 0) { log(sessionId, 'info', 'No safely retryable failed emails to resend.'); return }
  log(sessionId, 'info', `Re-queued ${requeued.count} failed email(s) for resend...`)
  r.running = true; r.cancelled = false; r.paused = false; r.consecutiveFailures = 0
  await runSendLoop(sessionId, r)
}

// ─────────────────────────────────────────────────────────────
// Socket.io: control events + log subscription
// ─────────────────────────────────────────────────────────────
function denySocketControl(socket: Socket, ack?: (result: any) => void) {
  if (socket.data.isService !== true) {
    if (ack) ack({ ok: false, error: 'Forbidden' })
    return true
  }
  if (!workerLeaseHeld || recoveryState !== 'ready') {
    if (ack) ack({ ok: false, error: 'Sender is not ready.' })
    return true
  }
  return false
}

io.on('connection', (socket: Socket) => {
  console.log(`Client connected: ${socket.id}`)
  if (!socket.data.isService) {
    const tokenExpiresAt = Number(socket.data.tokenExpiresAt)
    const expiryDelay = tokenExpiresAt - Date.now()
    if (!Number.isFinite(expiryDelay) || expiryDelay <= 0) {
      socket.disconnect(true)
      return
    }
    socket.data.expirationTimer = setTimeout(() => socket.disconnect(true), expiryDelay)
  }

  socket.on('control:start', (payload: { sessionId: string; smtpUser: string; smtpPass: string }, ack?: (r: any) => void) => {
    if (denySocketControl(socket, ack)) return
    startSession(payload).catch((e) => console.error('start error:', e))
    if (ack) ack({ ok: true })
  })
  socket.on('control:pause', (payload: { sessionId: string }, ack?: (r: any) => void) => {
    if (denySocketControl(socket, ack)) return
    pauseSession(payload.sessionId); if (ack) ack({ ok: true })
  })
  socket.on('control:resume', (payload: { sessionId: string }, ack?: (r: any) => void) => {
    if (denySocketControl(socket, ack)) return
    void resumeSession(payload.sessionId).catch((e) => console.error('resume error:', e))
    if (ack) ack({ ok: true })
  })
  socket.on('control:cancel', (payload: { sessionId: string }, ack?: (r: any) => void) => {
    if (denySocketControl(socket, ack)) return
    cancelSession(payload.sessionId); if (ack) ack({ ok: true })
  })
  socket.on('control:resend', (payload: { sessionId: string }, ack?: (r: any) => void) => {
    if (denySocketControl(socket, ack)) return
    resendFailed(payload.sessionId).catch((e) => console.error('resend error:', e))
    if (ack) ack({ ok: true })
  })

  socket.on('subscribe', (sessionId: string) => {
    if (typeof sessionId !== 'string') return
    if (!socket.data.isService && socket.data.sessionId !== sessionId) return
    const workspaceFilter = socket.data.isService ? {} : { workspaceId: socket.data.workspaceId }
    socket.join(`session:${sessionId}`)
    db.sendLog.findMany({
      where: { sessionId, ...workspaceFilter },
      orderBy: { createdAt: 'asc' },
      take: 300,
    })
      .then((logs) => {
        socket.emit('history', logs.map((l) => ({
          level: l.level, message: l.message, recipient: l.recipient, timestamp: l.createdAt.toISOString(),
        })))
      })
    db.emailSession.findFirst({
      where: { id: sessionId, ...workspaceFilter },
      select: { id: true, status: true, totalEmails: true, sentCount: true, failedCount: true, pendingCount: true, startedAt: true, completedAt: true },
    }).then((s) => { if (s) socket.emit('progress', s) })
    console.log(`Client subscribed to session ${sessionId}`)
  })
  socket.on('unsubscribe', (sessionId: string) => {
    if (!socket.data.isService && socket.data.sessionId !== sessionId) return
    socket.leave('session:' + sessionId)
  })

  socket.on('disconnect', () => {
    if (socket.data.expirationTimer) clearTimeout(socket.data.expirationTimer)
  })
})

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3003)

// Listen immediately so /health is available even while a cold database wakes;
// recovery retries in the background instead of blocking or crashing startup.
httpServer.listen(PORT, () => {
  console.log(`📨 email-sender service running on port ${PORT} (socket path ${SOCKET_PATH}, /health, /control/*)`)
})
recoverOnBoot().catch((e) => console.error('Boot recovery error:', e?.message || e))

async function shutdown(signal: string) {
  console.log(signal)
  recoveryState = 'degraded'
  if (workerLeaseHeartbeat) {
    clearInterval(workerLeaseHeartbeat)
    workerLeaseHeartbeat = null
  }
  if (recoveryRetryTimer) {
    clearTimeout(recoveryRetryTimer)
    recoveryRetryTimer = null
  }

  const activeRuns = [...runtimes.values()].some((runtime) => runtime.running)
  if (isPostgresDatabase && workerLeaseHeld && !activeRuns) {
    try {
      await db.workerLease.updateMany({
        where: { id: WORKER_LEASE_ID, ownerId: WORKER_INSTANCE_ID },
        data: { leaseExpiresAt: new Date(0) },
      })
      workerLeaseHeld = false
    } catch {
      // The lease will expire automatically if the database is unavailable.
    }
  }

  httpServer.close(() => {
    void db.$disconnect().finally(() => process.exit(0))
  })
}

process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT', () => { void shutdown('SIGINT') })
