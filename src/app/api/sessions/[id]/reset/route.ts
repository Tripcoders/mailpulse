import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// POST /api/sessions/[id]/reset — redo a campaign from scratch.
// Re-queues every recipient as pending, zeroes counters and returns the
// session to draft with a clean log, ready to send again with (optionally)
// new credentials. Refused while a send is active.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await db.emailSession.findUnique({ where: { id } })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (['running', 'paused', 'queued'].includes(session.status)) {
      return NextResponse.json({ error: 'Cancel the running campaign before resetting it' }, { status: 409 })
    }

    await db.$transaction([
      db.emailRecipient.updateMany({
        where: { sessionId: id },
        data: { status: 'pending', error: null, attemptCount: 0, sentAt: null },
      }),
      db.sendLog.deleteMany({ where: { sessionId: id } }),
      db.emailSession.update({
        where: { id },
        data: {
          status: 'draft',
          sentCount: 0,
          failedCount: 0,
          pendingCount: session.totalEmails,
          startedAt: null,
          completedAt: null,
        },
      }),
    ])

    await db.sendLog.create({
      data: { sessionId: id, level: 'info', message: `Campaign reset to draft — ${session.totalEmails} recipients re-queued for a fresh run` },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('reset session error', e)
    return NextResponse.json({ error: e?.message || 'Failed to reset campaign' }, { status: 500 })
  }
}
