import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { pauseSession } from '@/lib/sender-client'
import { withWorkspace } from '@/lib/workspace-context'
import { isVercelCampaignQueueEnabled } from '@/lib/campaign-queue'
import { logCampaign } from '@/lib/campaign-queue-service'
export const runtime = 'nodejs'
export const POST = withWorkspace(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (isVercelCampaignQueueEnabled()) {
    const session = await db.emailSession.findUnique({ where: { id } })
    if (!session) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    if (session.status === 'paused') return NextResponse.json({ ok: true, status: 'paused' })
    if (!['queued', 'running'].includes(session.status)) {
      return NextResponse.json({ error: 'Only an active campaign can be paused.' }, { status: 409 })
    }
    const paused = await db.emailSession.updateMany({
      where: { id, status: { in: ['queued', 'running'] } },
      data: { status: 'paused' },
    })
    if (paused.count !== 1) return NextResponse.json({ error: 'Campaign state changed. Refresh and try again.' }, { status: 409 })
    await logCampaign(id, 'warn', 'Campaign paused by user.')
    return NextResponse.json({ ok: true, status: 'paused' })
  }
  await pauseSession(id)
  return NextResponse.json({ ok: true })
})
