import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

// Production requires SECRET_KEY to be stable across web and worker instances,
// so SMTP passwords encrypted by one request can be decrypted by another.
// SECRET_KEY_PATH and db/secret.key are local-development fallbacks only. The
// key never leaves the server and is never included in an API response.
const SECRET = process.env.SECRET_KEY || ''
const KEY_PATH = process.env.SECRET_KEY_PATH || join(process.cwd(), 'db', 'secret.key')
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)

let cachedKey: Buffer | null = null

export function hasStableEncryptionKey() {
  if (SECRET.trim().length >= 32) return true
  if (isProduction) return false
  try {
    return existsSync(/*turbopackIgnore: true*/ KEY_PATH) &&
      readFileSync(/*turbopackIgnore: true*/ KEY_PATH, 'utf8').trim().length >= 32
  } catch {
    return false
  }
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  if (hasStableEncryptionKey()) {
    cachedKey = scryptSync(SECRET.trim(), 'mailpulse-salt-v1', 32)
    return cachedKey
  }
  if (isProduction) {
    throw new Error('Set a stable SECRET_KEY of at least 32 characters in every MailPulse runtime that reads stored sender credentials.')
  }
  if (existsSync(/*turbopackIgnore: true*/ KEY_PATH)) {
    const fileSecret = readFileSync(/*turbopackIgnore: true*/ KEY_PATH, 'utf8').trim()
    if (fileSecret.length < 32) throw new Error('The local SMTP encryption key file must contain at least 32 characters.')
    cachedKey = scryptSync(fileSecret, 'mailpulse-salt-v1', 32)
  } else {
    const raw = randomBytes(32).toString('hex')
    mkdirSync(dirname(KEY_PATH), { recursive: true })
    writeFileSync(KEY_PATH, raw, { mode: 0o600 })
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
