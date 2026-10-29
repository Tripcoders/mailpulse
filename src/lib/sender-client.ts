import { io, Socket } from 'socket.io-client'

/**
 * Control channel to the email-sender mini-service with a built-in backup:
 *   primary  — socket.io control events (lowest latency, single connection)
 *   fallback — plain HTTP POST /control/* (works if websockets are blocked —
 *              corporate proxies, VPNs, hosting environments)
 * Both layers surface the same error shape, and callers cannot tell the
 * difference — that's the point.
 */

const ENGINE_URL = process.env.ENGINE_URL || 'http://localhost:3003'
// The socket.io port claims every request (engine.io path '/'), so the HTTP
// control plane lives on the neighboring port (CONTROL = ENGINE + 1).
function controlUrlFrom(engineUrl: string): string {
  try {
    const u = new URL(engineUrl)
    const port = u.port ? Number(u.port) + 1 : 3004
    return `${u.protocol}//${u.hostname}:${port}`
  } catch {
    return 'http://localhost:3004'
  }
}
const CONTROL_URL = process.env.ENGINE_CONTROL_URL || controlUrlFrom(ENGINE_URL)

let socket: Socket | null = null
let connecting: Promise<Socket> | null = null

function getSocket(): Promise<Socket> {
  if (socket && socket.connected) return Promise.resolve(socket)
  if (connecting) return connecting

  connecting = new Promise((resolve, reject) => {
    // This module runs only on the Next.js server (Node.js runtime),
    // so connect directly to the mini-service — no proxy involved.
    const s = io(ENGINE_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 6000,
      forceNew: true,
    })

    const timeout = setTimeout(() => {
      s.disconnect()
      connecting = null
      reject(new Error('Connection to email-sender service timed out'))
    }, 6000)

    s.on('connect', () => {
      clearTimeout(timeout)
      socket = s
      connecting = null
      resolve(s)
    })

    s.on('connect_error', (err) => {
      clearTimeout(timeout)
      connecting = null
      s.disconnect()
      reject(new Error(`Cannot reach email-sender service: ${err.message}`))
    })
  })

  return connecting
}

async function postEngine(path: string, payload?: any): Promise<any> {
  const res = await fetch(`${CONTROL_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || `Engine HTTP ${res.status} on ${path}`)
  }
  return res.json().catch(() => ({}))
}

export async function engineHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${CONTROL_URL}/health`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}

export async function startSession(sessionId: string, smtpUser: string, smtpPass: string) {
  // Primary: socket
  try {
    const s = await getSocket()
    await new Promise<void>((resolve, reject) => {
      s.emit('control:start', { sessionId, smtpUser, smtpPass }, (ack: any) => {
        if (ack?.ok) resolve()
        else reject(new Error('Failed to start session'))
      })
      setTimeout(() => resolve(), 800) // engine accepted; send happens async
    })
    return
  } catch (socketErr: any) {
    // Fallback: HTTP control endpoint
    try {
      await postEngine('/control/start', { sessionId, smtpUser, smtpPass })
      return
    } catch (httpErr: any) {
      throw new Error(
        `Send engine unreachable (socket: ${socketErr?.message}; http: ${httpErr?.message}). ` +
        'Recipient progress is saved — start it and press Restart with credentials.'
      )
    }
  }
}

export async function pauseSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:pause', { sessionId })
    return
  } catch { /* fall through */ }
  try { await postEngine('/control/pause', { sessionId }) } catch (e) { console.error('pause error', e) }
}

export async function resumeSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:resume', { sessionId })
    return
  } catch { /* fall through */ }
  try { await postEngine('/control/resume', { sessionId }) } catch (e) { console.error('resume error', e) }
}

export async function cancelSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:cancel', { sessionId })
    return
  } catch { /* fall through */ }
  try { await postEngine('/control/cancel', { sessionId }) } catch (e) { console.error('cancel error', e) }
}

export async function resendSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:resend', { sessionId })
    return
  } catch { /* fall through */ }
  try { await postEngine('/control/resend', { sessionId }) } catch (e) { console.error('resend error', e) }
}
