import { rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

function uploadRoot() {
  return resolve(
    process.env.UPLOAD_DIR ||
      (process.env.VERCEL ? '/tmp/upload' : join(process.cwd(), 'upload')),
  )
}

export function getSafeLegacyAttachmentPath(filepath: string | null | undefined) {
  if (!filepath) return null
  const root = uploadRoot()
  const target = resolve(filepath)
  const relativePath = relative(root, target)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return null
  return target
}

export async function removeLegacyAttachmentFile(filepath: string | null | undefined) {
  const safePath = getSafeLegacyAttachmentPath(filepath)
  if (!safePath) return
  try {
    await rm(safePath, { force: true })
  } catch {
    // The original host may already have discarded its temporary attachment.
  }
}
