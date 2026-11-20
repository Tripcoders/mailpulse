import { decryptSecret, encryptSecret, hasStableEncryptionKey } from '@/lib/crypto'

// Wizard snapshots are JSON strings. They may contain the SMTP app password so
// that a full form can be restored after a logout, redeploy or browser reset.
// encryptSecret/decryptSecret use the same stable AES-256-GCM key as saved
// sender profiles, so the value is never stored in plain text.
const SEALED_FLAG = '__sealedSensitive'

export function sealFormSnapshot(content: string): string {
  try {
    const obj = JSON.parse(content)
    if (!obj || typeof obj !== 'object') return content
    if (typeof obj.smtpPass === 'string' && obj.smtpPass.length > 0) {
      if (!hasStableEncryptionKey()) {
        // Never persist a plaintext password. Drop it instead — the saved
        // sender profile still covers credential restore in this case.
        delete obj.smtpPass
        return JSON.stringify(obj)
      }
      obj.smtpPass = encryptSecret(obj.smtpPass)
      obj[SEALED_FLAG] = true
    }
    return JSON.stringify(obj)
  } catch {
    return content
  }
}

export function unsealFormSnapshot(content: string): string {
  try {
    const obj = JSON.parse(content)
    if (!obj || typeof obj !== 'object' || !obj[SEALED_FLAG]) return content
    if (typeof obj.smtpPass === 'string') {
      obj.smtpPass = decryptSecret(obj.smtpPass)
    }
    delete obj[SEALED_FLAG]
    return JSON.stringify(obj)
  } catch {
    return content
  }
}
