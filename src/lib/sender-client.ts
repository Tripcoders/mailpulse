import { io, Socket } from 'socket.io-client'
import { getEngineApiToken } from '@/lib/engine-auth'

/**
 * Control channel to the email-sender mini-service with a built-in backup:
 *   primary  — socket.io control events (lowest latency, single connection)
 *   fallback — plain HTTP POST /control/* (works if websockets are blocked —
 *              corporate proxies, VPNs, hosting environments)
 * Both layers surface the same error shape, and callers cannot tell the
 * difference — that's the point.
 */

const trimTrailingSlashes = (url: string) => url.trim().replace(/\/+$/, '')
const ENGINE_URL = trimTrailingSlashes(process.env.ENGINE_URL || 'http://localhost:3003')
// The engine serves socket.io and the HTTP control plane (/health,
// /control/*) on one port, so the control URL defaults to the same origin.
// ENGINE_CONTROL_URL stays available for unusual split deployments.
const CONTROL_URL = trimTrailingSlashes(process.env.ENGINE_CONTROL_URL || ENGINE_URL)

let socket: Socket | null = null
let connecting: Promise<Socket> | null = null

function getSocket(): Promise<Socket> {
  const engineToken = getEngineApiToken()
  if (!engineToken) return Promise.reject(new Error('ENGINE_API_TOKEN is not configured'))
  if (socket && socket.connected) return Promise.resolve(socket)
  if (connecting) return connecting

  connecting = new Promise((resolve, reject) => {
    // This module runs only on the Next.js server (Node.js runtime),
    // so connect directly to the mini-service — no proxy involved.
    const s = io(ENGINE_URL, {
      transports: ['websocket'],
      auth: { token: engineToken },
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

async function postEngine(path: string, payload?: any, timeoutMs = 10000): Promise<any> {
  const engineToken = getEngineApiToken()
  if (!engineToken) throw new Error('ENGINE_API_TOKEN is not configured')
  const res = await fetch(`${CONTROL_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + engineToken },
    body: JSON.stringify(payload || {}),
    signal: AbortSignal.timeout(timeoutMs),
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
      await postEngine('/control/start', { sessionId, smtpUser, smtpPass }, 25000)
      return
    } catch (httpErr: any) {
      console.error('Campaign start handoff failed:', {
        socketError: socketErr?.message || String(socketErr),
        httpError: httpErr?.message || String(httpErr),
      })
      throw new Error(
        'Campaign saved, but the send engine did not confirm startup. Check campaign progress before retrying; delivery may be uncertain.'
      )
    }
  }
}

export async function pauseSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:pause', { sessionId })
    return
  } catch (socketError) {
    try {
      await postEngine('/control/pause', { sessionId })
      return
    } catch (httpError) {
      console.error('Campaign pause handoff failed:', {
        socketError: socketError instanceof Error ? socketError.message : 'UnknownError',
        httpError: httpError instanceof Error ? httpError.message : 'UnknownError',
      })
      throw new Error('Could not reach the sender to pause this campaign. Refresh its status and try again.')
    }
  }
}

export async function resumeSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:resume', { sessionId })
    return
  } catch (socketError) {
    try {
      await postEngine('/control/resume', { sessionId })
      return
    } catch (httpError) {
      console.error('Campaign resume handoff failed:', {
        socketError: socketError instanceof Error ? socketError.message : 'UnknownError',
        httpError: httpError instanceof Error ? httpError.message : 'UnknownError',
      })
      throw new Error('Could not reach the sender to resume this campaign. Refresh its status and try again.')
    }
  }
}

export async function cancelSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:cancel', { sessionId })
    return
  } catch (socketError) {
    try {
      await postEngine('/control/cancel', { sessionId })
      return
    } catch (httpError) {
      console.error('Campaign cancel handoff failed:', {
        socketError: socketError instanceof Error ? socketError.message : 'UnknownError',
        httpError: httpError instanceof Error ? httpError.message : 'UnknownError',
      })
      throw new Error('Could not reach the sender to cancel this campaign. Refresh its status and try again.')
    }
  }
}

export async function resendSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:resend', { sessionId })
    return
  } catch (socketError) {
    try {
      await postEngine('/control/resend', { sessionId })
      return
    } catch (httpError) {
      console.error('Campaign resend handoff failed:', {
        socketError: socketError instanceof Error ? socketError.message : 'UnknownError',
        httpError: httpError instanceof Error ? httpError.message : 'UnknownError',
      })
      throw new Error('Could not reach the sender to retry failed recipients. Check campaign progress and try again.')
    }
  }
}
