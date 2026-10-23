import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'fs/promises'

// ─────────────────────────────────────────────────────────────
// Prisma client (shared DB with Next.js app)
// The DATABASE IS THE SOURCE OF TRUTH for send state: every
// recipient row is claimed (`sending`) before delivery and marked
// `sent`/`failed` atomically afterwards. A crash mid-run loses no
// progress — boot recovery re-queues claimed rows and stale runs.
// ─────────────────────────────────────────────────────────────
const db = new PrismaClient({
  log: ['error', 'warn'],
})

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
  consecutiveFailures: number
}

const runtimes = new Map<string, SessionRuntime>()

// Delivery retry policy: transient errors are retried with backoff.
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [2000, 5000]
const FAILURE_SPIKE_LIMIT = 5 // auto-pause after N consecutive failures

const TRANSIENT_RE = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|esocket|EPIPE|timeout|temporar|rate.?limit|greylist|421|451|deferr/i

// ─────────────────────────────────────────────────────────────
// Socket.io server + HTTP fallback server on a dedicated port.
// (socket.io with path '/' owns ALL requests on its port, so the
// HTTP control plane — used as the fallback transport and for
// health checks — runs on httpServer PORT+1.)
// ─────────────────────────────────────────────────────────────
const httpServer = createServer()

const controlServer = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const writeOk = (data: any = { ok: true }) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
  const writeErr = (msg: string, code = 400) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: msg })) }

  try {
    if (req.method === 'GET' && req.url?.startsWith('/health')) {
      return writeOk({ ok: true, uptime: Math.round(process.uptime()), runtimeSessions: runtimes.size })
    }

    if (req.method === 'POST') {
      const body = await new Promise<string>((resolve, reject) => {
        let data = ''; req.on('data', (c: any) => (data += c)); req.on('end', () => resolve(data || '{}')); req.on('error', reject)
        setTimeout(() => reject(new Error('body timeout')), 5000)
      })
      const payload = JSON.parse(body)

      if (req.url?.startsWith('/control/start')) {
        if (!payload?.sessionId || !payload?.smtpUser || !payload?.smtpPass) return writeErr('sessionId, smtpUser and smtpPass are required', 400)
        await startSession(payload)
        return writeOk()
      }
      if (req.url?.startsWith('/control/pause')) { pauseSession(payload.sessionId); return writeOk() }
      if (req.url?.startsWith('/control/resume')) { resumeSession(payload.sessionId); return writeOk() }
      if (req.url?.startsWith('/control/cancel')) { cancelSession(payload.sessionId); return writeOk() }
      if (req.url?.startsWith('/control/resend')) { await resendFailed(payload.sessionId); return writeOk() }
    }
  } catch (e: any) {
    return writeErr(e?.message || 'Engine error', 500)
  }
  return writeErr('Not found', 404)
})

const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function log(sessionId: string, level: string, message: string, recipient?: string) {
  const entry = { level, message, recipient, timestamp: new Date().toISOString() }
  db.sendLog.create({ data: { sessionId, level, message, recipient: recipient || null } }).catch(() => {})
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
  if (providerType === 'gmail') {
    host = 'smtp.gmail.com'; port = 465; secure = true
  } else if (providerType === 'yahoo') {
    host = 'smtp.mail.yahoo.com'; port = 465; secure = true
  } else if (providerType === 'outlook') {
    host = 'smtp.office365.com'; port = 587; secure = false
  } else if (providerType === 'icloud') {
    host = 'smtp.mail.me.com'; port = 587; secure = false
  } else if (providerType === 'zoho') {
    host = 'smtp.zoho.com'; port = 465; secure = true
  } else if (providerType === 'sendgrid') {
    host = 'smtp.sendgrid.net'; port = 587; secure = false
  } else if (providerType === 'mailgun') {
    host = 'smtp.mailgun.org'; port = 587; secure = false
  } else if (providerType === 'ses') {
    host = 'email-smtp.us-east-1.amazonaws.com'; port = 587; secure = false
  } else {
    host = smtpHost || 'smtp.example.com'
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
    try {
      const content = await readFile(f.filepath)
      attachments.push({ filename: f.filename, content, contentType: f.mimetype })
    } catch {
      log(sessionId, 'warn', `Could not read attachment ${f.filename}`)
    }
  }
  return attachments
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// ─────────────────────────────────────────────────────────────
// Boot recovery — crash/power-cut safe.
// 1. Rows claimed as `sending` by a dead engine go back to pending.
// 2. Sessions left in running/paused without a live runtime are
//    marked failed with a clear "how to continue" log; pending
//    counts survive, so "Restart with credentials" resumes exactly
//    where the crash happened.
// ─────────────────────────────────────────────────────────────
async function recoverOnBoot() {
  try {
    await db.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
    await db.$queryRawUnsafe('PRAGMA busy_timeout=5000;')
  } catch { /* pragma failures are non-fatal */ }

  const reclaimed = await db.emailRecipient.updateMany({
    where: { status: 'sending' },
    data: { status: 'pending' },
  })

  const stale = await db.emailSession.findMany({
    where: { status: { in: ['running', 'paused', 'queued'] } },
  })
  for (const s of stale) {
    await db.emailSession.update({
      where: { id: s.id },
      data: { status: 'failed', completedAt: new Date() },
    })
    log(s.id, 'warn', `Service restarted while "${s.name}" was ${s.status}. Progress preserved — ${s.pendingCount} recipient(s) still queued. Use "Restart with credentials" to continue, or "Reset" to re-run from scratch.`)
  }

  if (reclaimed.count > 0 || stale.length > 0) {
    console.log(`🛠 Recovery: reclaimed ${reclaimed.count} claimed recipient(s), ${stale.length} stale session(s) marked for restart`)
  }
}

// ─────────────────────────────────────────────────────────────
// Session lifecycle
// ─────────────────────────────────────────────────────────────
async function startSession(payload: { sessionId: string; smtpUser: string; smtpPass: string }) {
  const { sessionId, smtpUser, smtpPass } = payload
  if (!sessionId || !smtpUser || !smtpPass) throw new Error('sessionId, smtpUser and smtpPass are required')

  const session = await db.emailSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new Error('Session not found')

  const existing = runtimes.get(sessionId)
  if (existing && existing.running) {
    log(sessionId, 'warn', 'Session is already running')
    return
  }

  const transporter = buildTransporter(session.providerType, smtpUser, smtpPass, session.smtpHost, session.smtpPort, session.smtpSecure)
  const runtime: SessionRuntime = {
    sessionId, smtpUser, smtpPass, transporter,
    running: true, paused: false, cancelled: false,
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

  runtime.running = false
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
  await db.emailRecipient.update({ where: { id: recipient.id }, data: { status: 'sending' } })
  log(sessionId, 'info', `Sending to ${recipient.name ? recipient.name + ' ' : ''}<${recipient.email}>...`, recipient.email)

  let lastError: any = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (runtime.cancelled) return
    while (runtime.paused && !runtime.cancelled) { await sleep(400) }

    await db.emailRecipient.update({ where: { id: recipient.id }, data: { status: 'sending', attemptCount: { increment: 1 } } })
    try {
      const msg = buildMessage(session, recipient)
      const info = await runtime.transporter.sendMail({ ...msg, attachments })
      await db.emailRecipient.update({ where: { id: recipient.id }, data: { status: 'sent', sentAt: new Date(), error: null } })
      await db.emailSession.update({ where: { id: sessionId }, data: { sentCount: { increment: 1 }, pendingCount: { decrement: 1 } } })
      const mid = info.messageId ? String(info.messageId).slice(0, 24) : 'n/a'
      log(sessionId, 'success', `Delivered to ${recipient.email} (ID: ${mid})${attempt > 1 ? ` on retry ${attempt - 1}` : ''}`, recipient.email)
      runtime.consecutiveFailures = 0
      return // delivered
    } catch (e: any) {
      lastError = e
      const transient = TRANSIENT_RE.test(String(e?.message || ''))
      if (transient && attempt < MAX_ATTEMPTS && !runtime.cancelled) {
        const wait = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]
        log(sessionId, 'warn', `Transient error for ${recipient.email} (attempt ${attempt}) — retrying in ${wait / 1000}s: ${e.message}`, recipient.email)
        await sleep(wait)
      }
    }
  }

  // Attempt budget exhausted → terminal failure
  await db.emailRecipient.update({ where: { id: recipient.id }, data: { status: 'failed', error: String(lastError?.message || 'Unknown error') } })
  await db.emailSession.update({ where: { id: sessionId }, data: { failedCount: { increment: 1 }, pendingCount: { decrement: 1 } } })
  log(sessionId, 'error', `Failed for ${recipient.email}: ${lastError?.message}`, recipient.email)
  runtime.consecutiveFailures += 1
}

function pauseSession(sessionId: string) {
  const r = runtimes.get(sessionId)
  if (r && r.running) { r.paused = true; log(sessionId, 'warn', 'Session paused') }
}
function resumeSession(sessionId: string) {
  const r = runtimes.get(sessionId)
  if (r && r.running) { r.paused = false; r.consecutiveFailures = 0; log(sessionId, 'info', 'Session resumed') }
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
  const failed = await db.emailRecipient.findMany({ where: { sessionId, status: 'failed' } })
  if (failed.length === 0) { log(sessionId, 'info', 'No failed emails to resend.'); return }
  await db.emailRecipient.updateMany({ where: { sessionId, status: 'failed' }, data: { status: 'pending', error: null } })
  await db.emailSession.update({
    where: { id: sessionId },
    data: { status: 'running', failedCount: 0, pendingCount: failed.length, completedAt: null },
  })
  log(sessionId, 'info', `Re-queuing ${failed.length} failed email(s) for resend...`)
  r.running = true; r.cancelled = false; r.paused = false; r.consecutiveFailures = 0
  await runSendLoop(sessionId, r)
}

// ─────────────────────────────────────────────────────────────
// Socket.io: control events + log subscription
// ─────────────────────────────────────────────────────────────
io.on('connection', (socket: Socket) => {
  console.log(`Client connected: ${socket.id}`)

  socket.on('control:start', (payload: { sessionId: string; smtpUser: string; smtpPass: string }, ack?: (r: any) => void) => {
    startSession(payload).catch((e) => console.error('start error:', e))
    if (ack) ack({ ok: true })
  })
  socket.on('control:pause', (payload: { sessionId: string }, ack?: (r: any) => void) => {
    pauseSession(payload.sessionId); if (ack) ack({ ok: true })
  })
  socket.on('control:resume', (payload: { sessionId: string }, ack?: (r: any) => void) => {
    resumeSession(payload.sessionId); if (ack) ack({ ok: true })
  })
  socket.on('control:cancel', (payload: { sessionId: string }, ack?: (r: any) => void) => {
    cancelSession(payload.sessionId); if (ack) ack({ ok: true })
  })
  socket.on('control:resend', (payload: { sessionId: string }, ack?: (r: any) => void) => {
    resendFailed(payload.sessionId).catch((e) => console.error('resend error:', e))
    if (ack) ack({ ok: true })
  })

  socket.on('subscribe', (sessionId: string) => {
    socket.join(`session:${sessionId}`)
    db.sendLog.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 300 })
      .then((logs) => {
        socket.emit('history', logs.map((l) => ({
          level: l.level, message: l.message, recipient: l.recipient, timestamp: l.createdAt.toISOString(),
        })))
      })
    db.emailSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, totalEmails: true, sentCount: true, failedCount: true, pendingCount: true, startedAt: true, completedAt: true },
    }).then((s) => { if (s) socket.emit('progress', s) })
    console.log(`Client subscribed to session ${sessionId}`)
  })
  socket.on('unsubscribe', (sessionId: string) => { socket.leave(`session:${sessionId}`) })

  socket.on('disconnect', () => {})
})

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3003)
const CONTROL_PORT = Number(process.env.CONTROL_PORT || PORT + 1)

recoverOnBoot().finally(() => {
  httpServer.listen(PORT, () => {
    console.log(`📨 email-sender service running on port ${PORT} (socket.io)`)
  })
  controlServer.listen(CONTROL_PORT, () => {
    console.log(`🛟 engine HTTP control plane on port ${CONTROL_PORT} (/health, /control/*)`)
  })
})

process.on('SIGTERM', () => { console.log('SIGTERM'); httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { console.log('SIGINT'); httpServer.close(() => process.exit(0)) })
