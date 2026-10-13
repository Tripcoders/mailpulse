import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/sessions/[id]/recipients?status=&page=&pageSize=&q=
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || undefined
  const q = searchParams.get('q') || undefined
  const page = Math.max(1, Number(searchParams.get('page') || '1'))
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') || '50')))

  const where: any = { sessionId: id }
  if (status && status !== 'all') where.status = status
  if (q) {
    where.OR = [
      { email: { contains: q } },
      { name: { contains: q } },
    ]
  }

  const [recipients, total] = await Promise.all([
    db.emailRecipient.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.emailRecipient.count({ where }),
  ])

  return NextResponse.json({ recipients, total, page, pageSize })
}
