import { NextResponse } from 'next/server'
import { withWorkspace } from '@/lib/workspace-context'
export const runtime = 'nodejs'
export const GET = withWorkspace(async (_request: Request) => {
  return NextResponse.json({ service: 'MailPulse API', ok: true })
})
