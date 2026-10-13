import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/signatures
export async function GET() {
  const signatures = await db.signature.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ signatures })
}

// POST /api/signatures  { name, type, content }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, type, content } = body
  if (!name || !type || !content) {
    return NextResponse.json({ error: 'name, type and content are required' }, { status: 400 })
  }
  if (type !== 'text' && type !== 'image') {
    return NextResponse.json({ error: 'type must be "text" or "image"' }, { status: 400 })
  }
  const sig = await db.signature.create({ data: { name, type, content } })
  return NextResponse.json({ signature: sig })
}

// DELETE /api/signatures?id=...
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.signature.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
