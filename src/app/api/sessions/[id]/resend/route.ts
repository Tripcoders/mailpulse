import { NextRequest, NextResponse } from 'next/server'
import { resendSession } from '@/lib/sender-client'
import { withWorkspace } from '@/lib/workspace-context'
import { isVercelCampaignQueueEnabled } from '@/lib/campaign-queue'
import { CampaignStartError, startQueuedCampaign } from '@/lib/campaign-queue-service'
export const runtime = 'nodejs'
export const maxDuration = 60
export const POST = withWorkspace(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  if (isVercelCampaignQueueEnabled()) {
    const body = await req.json().catch(() => null)
    try {
      const result = await startQueuedCampaign(
        id,
        body && typeof body === 'object' ? body : undefined,
        { resendFailedRecipients: true },
      )
      return NextResponse.json(result, { status: 202, headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof CampaignStartError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      console.error('Campaign resend failed:', error instanceof Error ? error.name : 'UnknownError')
      return NextResponse.json({ error: 'Failed recipients could not be queued. Refresh the campaign and try again.' }, { status: 503 })
    }
  }

  await resendSession(id)
  return NextResponse.json({ ok: true })
})
