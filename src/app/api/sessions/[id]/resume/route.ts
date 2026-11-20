import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resumeSession } from '@/lib/sender-client'
import { withWorkspace } from '@/lib/workspace-context'
import { isVercelCampaignQueueEnabled } from '@/lib/campaign-queue'
import { CampaignStartError, startQueuedCampaign } from '@/lib/campaign-queue-service'
export const runtime = 'nodejs'
export const maxDuration = 60
export const POST = withWorkspace(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (isVercelCampaignQueueEnabled()) {
    const session = await db.emailSession.findUnique({ where: { id } })
    if (!session) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    if (session.status !== 'paused') {
      return NextResponse.json({ error: 'Only a paused campaign can be resumed. Restart it with credentials if it has stopped.' }, { status: 409 })
    }
    try {
      return NextResponse.json(await startQueuedCampaign(id), { status: 202 })
    } catch (error) {
      if (error instanceof CampaignStartError) return NextResponse.json({ error: error.message }, { status: error.status })
      console.error('Campaign resume failed:', error instanceof Error ? error.name : 'UnknownError')
      return NextResponse.json({ error: 'Campaign could not be resumed. Check its progress and try again.' }, { status: 503 })
    }
  }
  await resumeSession(id)
  return NextResponse.json({ ok: true })
})
