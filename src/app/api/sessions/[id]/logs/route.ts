import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/sessions/[id]/logs?limit=
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const limit = Math.min(1000, Math.max(1, Number(searchParams.get('limit') || '500')))
  const logs = await db.sendLog.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  return NextResponse.json({ logs })
}
