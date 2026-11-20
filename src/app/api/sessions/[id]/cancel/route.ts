import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { cancelSession } from '@/lib/sender-client'
import { withWorkspace } from '@/lib/workspace-context'
import { isVercelCampaignQueueEnabled } from '@/lib/campaign-queue'
import { logCampaign } from '@/lib/campaign-queue-service'
export const runtime = 'nodejs'
export const POST = withWorkspace(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (isVercelCampaignQueueEnabled()) {
    const session = await db.emailSession.findUnique({ where: { id } })
    if (!session) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    if (['completed', 'cancelled'].includes(session.status)) return NextResponse.json({ ok: true, status: session.status })
    const cancelled = await db.emailSession.updateMany({
      where: { id, status: { in: ['queued', 'running', 'paused'] } },
      data: { status: 'cancelled', completedAt: new Date() },
    })
    if (cancelled.count !== 1) return NextResponse.json({ error: 'Campaign state changed. Refresh and try again.' }, { status: 409 })
    await logCampaign(id, 'warn', 'Campaign cancelled by user. In-flight delivery may finish; queued recipients will not be sent.')
    return NextResponse.json({ ok: true, status: 'cancelled' })
  }
  await cancelSession(id)
  return NextResponse.json({ ok: true })
})
