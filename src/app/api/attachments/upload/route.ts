import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, access } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

// Repo-local staging dir by default; configurable for Docker/production
// (docker-compose mounts a shared volume and passes UPLOAD_DIR to both the
// web app and the send engine so attachments survive restarts and work
// across containers). On Vercel's serverless platform the filesystem is
// read-only except /tmp, so we stage uploads there.
export const UPLOAD_DIR = process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/upload' : join(process.cwd(), 'upload'))

// POST /api/attachments/upload  (FormData: field "file")
// Stages an attachment on disk and returns its metadata. The file is linked to a
// session at session-creation time (caller passes the metadata back).
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded. Please select a file.' }, { status: 400 })
    }

    // 25 MB limit
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 400 })
    }

    if (file.size === 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 })
    }

    const stagingId = randomUUID()
    const dir = join(UPLOAD_DIR, stagingId)
    try {
      await mkdir(dir, { recursive: true })
    } catch (mkdirErr: any) {
      // If mkdir fails, try /tmp as fallback
      const fallbackDir = join('/tmp', 'upload', stagingId)
      await mkdir(fallbackDir, { recursive: true })
      // Use fallback
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
      const filepath = join(fallbackDir, safeName)
      const buf = Buffer.from(await file.arrayBuffer())
      await writeFile(filepath, buf)
      return NextResponse.json({
        stagingId,
        filename: file.name,
        filepath,
        mimetype: file.type || 'application/octet-stream',
        size: file.size,
      })
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const filepath = join(dir, safeName)
    const buf = Buffer.from(await file.arrayBuffer())
    await writeFile(filepath, buf)

    return NextResponse.json({
      stagingId,
      filename: file.name,
      filepath,
      mimetype: file.type || 'application/octet-stream',
      size: file.size,
    })
  } catch (e: any) {
    console.error('Upload error:', e)
    return NextResponse.json({ error: e?.message || 'Upload failed. Please try again.' }, { status: 500 })
  }
}