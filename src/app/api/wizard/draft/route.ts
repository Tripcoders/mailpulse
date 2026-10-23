import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/wizard/draft — the last auto-saved wizard snapshot + when it was saved.
export async function GET() {
  try {
    const draft = await db.wizardDraft.findUnique({ where: { id: 'main' } })
    return NextResponse.json({ draft: draft ? { content: draft.content, updatedAt: draft.updatedAt } : null })
  } catch (e: any) {
    console.error('draft get error', e)
    return NextResponse.json({ draft: null })
  }
}

// PUT /api/wizard/draft — autosave (called debounced from the wizard).
export async function PUT(req: NextRequest) {
  try {
    const { content } = await req.json()
    if (typeof content !== 'string' || content.length > 3_000_000) {
      return NextResponse.json({ error: 'Invalid draft payload' }, { status: 400 })
    }
    await db.wizardDraft.upsert({
      where: { id: 'main' },
      update: { content },
      create: { id: 'main', content },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('draft put error', e)
    return NextResponse.json({ error: e?.message || 'Failed to save draft' }, { status: 500 })
  }
}

// DELETE /api/wizard/draft — discard after successful restore or explicit clear.
export async function DELETE() {
  try {
    await db.wizardDraft.delete({ where: { id: 'main' } }).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to clear draft' }, { status: 500 })
  }
}
