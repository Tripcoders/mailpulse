import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withWorkspace } from '@/lib/workspace-context'
import { ensureTemplateSchema } from '@/lib/template-schema'
import { sealFormSnapshot, unsealFormSnapshot } from '@/lib/form-snapshot'

export const runtime = 'nodejs'

const MAX_SNAPSHOT_CHARS = 3_000_000
const MAX_IMAGE_CHARS = 3_000_000

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.slice(0, MAX_IMAGE_CHARS)
}

// A template can hold the complete wizard setup (recipients, sender, throttles
// and the app password). The password is encrypted before it reaches the DB and
// decrypted again when the template is read, so selecting a template is a true
// one-click resume even after a redeploy or a fresh login.
function buildData(body: Record<string, any>) {
  const data: Record<string, any> = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120)
  if (typeof body.category === 'string' && body.category.trim()) data.category = body.category.trim().slice(0, 60)
  if (typeof body.subject === 'string') data.subject = body.subject
  if (typeof body.body === 'string') data.body = body.body
  if (typeof body.plainText === 'string') data.plainText = body.plainText
  if ('signatureText' in body) data.signatureText = nullableText(body.signatureText)
  if ('signatureImage' in body) data.signatureImage = nullableText(body.signatureImage)
  if ('imageData' in body) data.imageData = nullableText(body.imageData)
  if ('imageLabel' in body) data.imageLabel = nullableText(body.imageLabel)
  if ('fromName' in body) data.fromName = nullableText(body.fromName)
  if ('fromEmail' in body) data.fromEmail = nullableText(body.fromEmail)
  if ('providerType' in body) data.providerType = nullableText(body.providerType)
  if (typeof body.snapshot === 'string') {
    data.snapshot = sealFormSnapshot(body.snapshot.slice(0, MAX_SNAPSHOT_CHARS))
  } else if ('snapshot' in body) {
    data.snapshot = null
  }
  return data
}

function publicTemplate(template: any) {
  if (!template) return template
  return {
    ...template,
    snapshot: template.snapshot ? unsealFormSnapshot(template.snapshot) : null,
  }
}

// GET /api/templates — reusable emails, newest first.
export const GET = withWorkspace(async (_req: NextRequest) => {
  await ensureTemplateSchema()
  const templates = await db.emailTemplate.findMany({ orderBy: { updatedAt: 'desc' } })
  return NextResponse.json({ templates: templates.map(publicTemplate) })
})

// POST /api/templates — saving with an existing name overwrites that template
// instead of creating a duplicate (the common "save again after editing" case).
export const POST = withWorkspace(async (req: NextRequest) => {
  try {
    await ensureTemplateSchema()
    const body = await req.json()
    const data = buildData(body)
    if (!text(data.subject).trim() && !text(data.body).trim() && !data.snapshot) {
      return NextResponse.json({ error: 'Write a subject or email body before saving' }, { status: 400 })
    }
    const name = data.name || text(data.subject).trim().slice(0, 60) || 'Untitled email'
    data.name = name
    data.category = data.category || 'General'
    data.subject = data.subject ?? ''
    data.body = data.body ?? ''

    const existing = await db.emailTemplate.findFirst({ where: { name } })
    const template = existing
      ? await db.emailTemplate.update({ where: { id: existing.id }, data })
      : await db.emailTemplate.create({ data })

    return NextResponse.json({ template: publicTemplate(template) })
  } catch (e: any) {
    console.error('template save error', e)
    return NextResponse.json({ error: e?.message || 'Failed to save template' }, { status: 500 })
  }
})

// PATCH /api/templates — update any saved field in place.
export const PATCH = withWorkspace(async (req: NextRequest) => {
  try {
    await ensureTemplateSchema()
    const body = await req.json()
    const id = text(body.id)
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const data = buildData(body)
    delete data.name // renaming is POST's job (name is the upsert key)
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    const template = await db.emailTemplate.update({ where: { id }, data })
    return NextResponse.json({ template: publicTemplate(template) })
  } catch (e: any) {
    console.error('template update error', e)
    return NextResponse.json({ error: e?.message || 'Failed to update template' }, { status: 500 })
  }
})

// DELETE /api/templates?id=...
export const DELETE = withWorkspace(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await ensureTemplateSchema()
  await db.emailTemplate.delete({ where: { id } })
  return NextResponse.json({ ok: true })
})
