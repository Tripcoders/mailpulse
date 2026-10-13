import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import nodemailer from 'nodemailer'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'fs/promises'

// ─────────────────────────────────────────────────────────────
// Prisma client (shared DB with Next.js app)
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
  transporter: nodemailer.Transporter
  running: boolean
  paused: boolean
  cancelled: boolean
}

const runtimes = new Map<string, SessionRuntime>()

// ─────────────────────────────────────────────────────────────
// HTTP + Socket.io server
// ─────────────────────────────────────────────────────────────
const httpServer = createServer()
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
  const attachments = []
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
// Session lifecycle
// ─────────────────────────────────────────────────────────────
async function startSession(payload: { sessionId: string; smtpUser: string; smtpPass: string }) {
  const { sessionId, smtpUser, smtpPass } = payload
  const session = await db.emailSession.findUnique({ where: { id: sessionId } })
  if (!session) { console.error('Session not found:', sessionId); return }

  const existing = runtimes.get(sessionId)
  if (existing && existing.running) {
    log(sessionId, 'warn', 'Session is already running')
    return
  }

  const transporter = buildTransporter(session.providerType, smtpUser, smtpPass, session.smtpHost, session.smtpPort, session.smtpSecure)
  const runtime: SessionRuntime = {
    sessionId, smtpUser, smtpPass, transporter,
    running: true, paused: false, cancelled: false,
  }
  runtimes.set(sessionId, runtime)

  await db.emailSession.update({ where: { id: sessionId }, data: { status: 'running', startedAt: new Date() } })

  log(sessionId, 'info', `Starting send session "${session.name}"`)
  log(sessionId, 'info', `Provider: ${session.providerType.toUpperCase()} | Sender: ${session.fromName} <${session.fromEmail}>`)
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
      if (session.perEmailDelayMs > 0) await sleep(session.perEmailDelayMs)
    }
    if (runtime.cancelled) break

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

async function sendOne(
  sessionId: string, runtime: SessionRuntime, session: any,
  recipient: { id: string; email: string; name: string }, attachments: any[]
) {
  await db.emailRecipient.update({ where: { id: recipient.id }, data: { status: 'sending', attemptCount: { increment: 1 } } })
  log(sessionId, 'info', `Sending to ${recipient.name ? recipient.name + ' ' : ''}<${recipient.email}>...`, recipient.email)
  try {
    const msg = buildMessage(session, recipient)
    const info = await runtime.transporter.sendMail({ ...msg, attachments })
    await db.emailRecipient.update({ where: { id: recipient.id }, data: { status: 'sent', sentAt: new Date(), error: null } })
    await db.emailSession.update({ where: { id: sessionId }, data: { sentCount: { increment: 1 }, pendingCount: { decrement: 1 } } })
    const mid = info.messageId ? String(info.messageId).slice(0, 24) : 'n/a'
    log(sessionId, 'success', `Delivered to ${recipient.email} (ID: ${mid})`, recipient.email)
  } catch (e: any) {
    await db.emailRecipient.update({ where: { id: recipient.id }, data: { status: 'failed', error: e.message } })
    await db.emailSession.update({ where: { id: sessionId }, data: { failedCount: { increment: 1 }, pendingCount: { decrement: 1 } } })
    log(sessionId, 'error', `Failed for ${recipient.email}: ${e.message}`, recipient.email)
  }
}

function pauseSession(sessionId: string) {
  const r = runtimes.get(sessionId)
  if (r) { r.paused = true; log(sessionId, 'warn', 'Session paused') }
}
function resumeSession(sessionId: string) {
  const r = runtimes.get(sessionId)
  if (r) { r.paused = false; log(sessionId, 'info', 'Session resumed') }
}
function cancelSession(sessionId: string) {
  const r = runtimes.get(sessionId)
  if (r) { r.cancelled = true; r.paused = false; log(sessionId, 'warn', 'Cancellation requested...') }
}
async function resendFailed(sessionId: string) {
  const session = await db.emailSession.findUnique({ where: { id: sessionId } })
  if (!session) return
  const r = runtimes.get(sessionId)
  if (!r) { log(sessionId, 'error', 'Cannot resend: session runtime expired. Re-start with credentials.'); return }
  if (r.running) { log(sessionId, 'warn', 'Session is already running.'); return }
  const failed = await db.emailRecipient.findMany({ where: { sessionId, status: 'failed' } })
  if (failed.length === 0) { log(sessionId, 'info', 'No failed emails to resend.'); return }
  await db.emailRecipient.updateMany({ where: { sessionId, status: 'failed' }, data: { status: 'pending', error: null } })
  await db.emailSession.update({ where: { id: sessionId }, data: { status: 'running', failedCount: 0, pendingCount: failed.length, completedAt: null } })
  log(sessionId, 'info', `Re-queuing ${failed.length} failed email(s) for resend...`)
  r.running = true; r.cancelled = false; r.paused = false
  await runSendLoop(sessionId, r)
}

// ─────────────────────────────────────────────────────────────
// Socket.io: control events + log subscription
// ─────────────────────────────────────────────────────────────
io.on('connection', (socket: Socket) => {
  console.log(`Client connected: ${socket.id}`)

  // Control events (from Next.js backend) with ack
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

  // Log subscription (from frontend)
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
const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`📨 email-sender service running on port ${PORT}`)
})

process.on('SIGTERM', () => { console.log('SIGTERM'); httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { console.log('SIGINT'); httpServer.close(() => process.exit(0)) })
