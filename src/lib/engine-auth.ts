import { createHmac } from 'node:crypto'

type SessionSocketTokenInput = {
  sessionId: string
  workspaceId: string
  userId: string
}

export function getEngineApiToken() {
  return process.env.ENGINE_API_TOKEN?.trim() || null
}

export function createSessionSocketToken(input: SessionSocketTokenInput) {
  const secret = getEngineApiToken()
  if (!secret) return null

  const payload = {
    iss: 'mailpulse-web',
    aud: 'mailpulse-engine',
    purpose: 'session-read',
    sid: input.sessionId,
    wid: input.workspaceId,
    uid: input.userId,
    exp: Math.floor(Date.now() / 1000) + 180,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return encoded + '.' + signature
}
