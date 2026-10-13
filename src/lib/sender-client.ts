import { io, Socket } from 'socket.io-client'

// Singleton socket.io client that connects to the email-sender mini-service.
// Used by Next.js API routes to send control commands (start/pause/resume/cancel/resend).
// SMTP credentials are passed through this channel (kept in memory only, never persisted).

let socket: Socket | null = null
let connecting: Promise<Socket> | null = null

function getSocket(): Promise<Socket> {
  if (socket && socket.connected) return Promise.resolve(socket)
  if (connecting) return connecting

  connecting = new Promise((resolve, reject) => {
    // This module runs only on the Next.js server (Node.js runtime),
    // so connect directly to the mini-service — no Caddy gateway involved.
    const s = io('http://localhost:3003', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
      timeout: 8000,
      forceNew: true,
    })

    const timeout = setTimeout(() => {
      reject(new Error('Connection to email-sender service timed out'))
    }, 8000)

    s.on('connect', () => {
      clearTimeout(timeout)
      socket = s
      connecting = null
      resolve(s)
    })

    s.on('connect_error', (err) => {
      clearTimeout(timeout)
      connecting = null
      reject(new Error(`Cannot reach email-sender service: ${err.message}`))
    })

    s.on('disconnect', () => {
      // will auto-reconnect
    })
  })

  return connecting
}

export async function startSession(sessionId: string, smtpUser: string, smtpPass: string) {
  const s = await getSocket()
  await new Promise<void>((resolve, reject) => {
    s.emit('control:start', { sessionId, smtpUser, smtpPass }, (ack: any) => {
      if (ack?.ok) resolve()
      else reject(new Error('Failed to start session'))
    })
    // Resolve even without ack after a short delay (service accepted)
    setTimeout(() => resolve(), 500)
  })
}

export async function pauseSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:pause', { sessionId })
  } catch (e) {
    console.error('pause error', e)
  }
}

export async function resumeSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:resume', { sessionId })
  } catch (e) {
    console.error('resume error', e)
  }
}

export async function cancelSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:cancel', { sessionId })
  } catch (e) {
    console.error('cancel error', e)
  }
}

export async function resendSession(sessionId: string) {
  try {
    const s = await getSocket()
    s.emit('control:resend', { sessionId })
  } catch (e) {
    console.error('resend error', e)
  }
}
