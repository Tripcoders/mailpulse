import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withWorkspace } from '@/lib/workspace-context'

export const runtime = 'nodejs'

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
const STAGED_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000

function safeFilename(value: string) {
  return value.replace(/[\\/\0-\x1f\x7f]+/g, '_').trim().slice(0, 255) || 'attachment'
}

function safeMimeType(value: string) {
  return /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value : 'application/octet-stream'
}

// POST /api/attachments/upload (FormData: field "file")
// Staged bytes live in Neon for 24 hours and are claimed by a campaign at creation.
export const POST = withWorkspace(async (req: NextRequest) => {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded. Please select a file.' }, { status: 400 })
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: 'File too large (max 4 MiB per attachment).' }, { status: 413 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'File is empty.' }, { status: 400 })
    }

    const now = new Date()
    await db.attachment.deleteMany({
      where: { sessionId: null, expiresAt: { lt: now } },
    })

    const content = Buffer.from(await file.arrayBuffer())
    if (content.byteLength !== file.size) {
      return NextResponse.json({ error: 'The uploaded file was incomplete. Please try again.' }, { status: 400 })
    }

    const attachment = await db.attachment.create({
      data: {
        filename: safeFilename(file.name),
        filepath: null,
        content,
        mimetype: safeMimeType(file.type),
        size: file.size,
        sessionId: null,
        expiresAt: new Date(now.getTime() + STAGED_ATTACHMENT_TTL_MS),
      },
      select: { id: true, filename: true, mimetype: true, size: true },
    })

    return NextResponse.json({
      stagingId: attachment.id,
      filename: attachment.filename,
      mimetype: attachment.mimetype,
      size: attachment.size,
    })
  } catch (error) {
    console.error('Attachment upload failed:', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
})
