import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/templates
export async function GET() {
  const templates = await db.emailTemplate.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ templates })
}

// POST /api/templates  { name, subject, body }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, subject, body: bodyHtml } = body
  if (!name || !subject || !bodyHtml) {
    return NextResponse.json({ error: 'name, subject and body are required' }, { status: 400 })
  }
  const tpl = await db.emailTemplate.create({ data: { name, subject, body: bodyHtml } })
  return NextResponse.json({ template: tpl })
}

// DELETE /api/templates?id=...
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.emailTemplate.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
