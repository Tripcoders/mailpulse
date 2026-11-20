import { handleCallback } from '@vercel/queue'
import { handleCampaignQueueMessage } from '@/lib/campaign-queue-worker'

export const runtime = 'nodejs'
export const maxDuration = 300

export const POST = handleCallback(handleCampaignQueueMessage, {
  visibilityTimeoutSeconds: 360,
  retry: () => ({ afterSeconds: 60 }),
})
