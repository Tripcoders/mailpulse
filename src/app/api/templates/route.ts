import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withWorkspace } from '@/lib/workspace-context'

export const runtime = 'nodejs'

// GET /api/templates — reusable emails, newest first.
export const GET = withWorkspace(async (_req: NextRequest) => {
  const templates = await db.emailTemplate.findMany({ orderBy: { updatedAt: 'desc' } })
  return NextResponse.json({ templates })
})

// POST /api/templates  { name?, subject, body, signatureText?, signatureImage? }
// Saving with an existing name overwrites that template instead of creating a
// duplicate — the common "save again after editing" case.
export const POST = withWorkspace(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const subject = String(body.subject || '')
    const bodyHtml = String(body.body || '')
    const rawName = String(body.name || '').trim()
    if (!subject.trim() && !bodyHtml.trim()) {
      return NextResponse.json({ error: 'Write a subject or email body before saving' }, { status: 400 })
    }
    const name = rawName || subject.trim().slice(0, 60) || 'Untitled email'
    const data = {
      name,
      subject,
      body: bodyHtml,
      signatureText: body.signatureText ? String(body.signatureText) : null,
      signatureImage: body.signatureImage ? String(body.signatureImage) : null,
    }

    const existing = await db.emailTemplate.findFirst({ where: { name } })
    const template = existing
      ? await db.emailTemplate.update({ where: { id: existing.id }, data })
      : await db.emailTemplate.create({ data })

    return NextResponse.json({ template })
  } catch (e: any) {
    console.error('template save error', e)
    return NextResponse.json({ error: e?.message || 'Failed to save template' }, { status: 500 })
  }
})

// PATCH /api/templates  { id, name?, subject?, body?, signatureText?, signatureImage? }
export const PATCH = withWorkspace(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const data: Record<string, any> = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
    if (typeof body.subject === 'string') data.subject = body.subject
    if (typeof body.body === 'string') data.body = body.body
    if (body.signatureText !== undefined) data.signatureText = body.signatureText ? String(body.signatureText) : null
    if (body.signatureImage !== undefined) data.signatureImage = body.signatureImage ? String(body.signatureImage) : null
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const template = await db.emailTemplate.update({ where: { id }, data })
    return NextResponse.json({ template })
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
  await db.emailTemplate.delete({ where: { id } })
  return NextResponse.json({ ok: true })
})
