import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withWorkspace } from '@/lib/workspace-context'
import { currentWorkspaceId } from '@/lib/workspace-store'
import { sealFormSnapshot, unsealFormSnapshot } from '@/lib/form-snapshot'

export const runtime = 'nodejs'

// GET /api/wizard/draft — the last auto-saved wizard snapshot + when it was saved.
export const GET = withWorkspace(async (_req: NextRequest) => {
  try {
    const draftId = currentWorkspaceId() + ':main'
    const draft = await db.wizardDraft.findUnique({ where: { id: draftId } })
    // Sealed on write, unsealed on read: the database never holds a plaintext
    // app password, but a returning user gets their whole form back.
    return NextResponse.json({
      draft: draft ? { content: unsealFormSnapshot(draft.content), updatedAt: draft.updatedAt } : null,
    })
  } catch (e: any) {
    console.error('draft get error', e)
    return NextResponse.json({ draft: null })
  }
})

// PUT /api/wizard/draft — autosave (called debounced from the wizard).
export const PUT = withWorkspace(async (req: NextRequest) => {
  try {
    const { content } = await req.json()
    if (typeof content !== 'string' || content.length > 3_000_000) {
      return NextResponse.json({ error: 'Invalid draft payload' }, { status: 400 })
    }
    const draftId = currentWorkspaceId() + ':main'
    const sealed = sealFormSnapshot(content)
    await db.wizardDraft.upsert({
      where: { id: draftId },
      update: { content: sealed },
      create: { id: draftId, content: sealed },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('draft put error', e)
    return NextResponse.json({ error: e?.message || 'Failed to save draft' }, { status: 500 })
  }
})

// DELETE /api/wizard/draft — discard after successful restore or explicit clear.
export const DELETE = withWorkspace(async (_req: NextRequest) => {
  try {
    const draftId = currentWorkspaceId() + ':main'
    await db.wizardDraft.delete({ where: { id: draftId } }).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to clear draft' }, { status: 500 })
  }
})
