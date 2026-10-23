import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// The key lives at SECRET_KEY_PATH (configurable for containers that mount a
// shared volume) or db/secret.key, and is generated on first use — it never
// leaves this machine and is never included in any API response, so passwords
// are stored encrypted and can only be decrypted server-side at send time.
const KEY_PATH = process.env.SECRET_KEY_PATH || join(process.cwd(), 'db', 'secret.key')

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  if (existsSync(KEY_PATH)) {
    cachedKey = scryptSync(readFileSync(KEY_PATH, 'utf8').trim(), 'mailpulse-salt-v1', 32)
  } else {
    const raw = randomBytes(32).toString('hex')
    try {
      writeFileSync(KEY_PATH, raw, { mode: 0o600 })
    } catch {
      // e.g. read-only fs — fall back to a process-lifetime key
    }
    cachedKey = scryptSync(raw, 'mailpulse-salt-v1', 32)
  }
  return cachedKey
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}.${tag.toString('hex')}.${enc.toString('hex')}`
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split('.')
  if (!ivHex || !tagHex || !dataHex) return ''
  try {
    const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}
