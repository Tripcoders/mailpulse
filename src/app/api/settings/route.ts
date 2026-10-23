import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/settings — remembered preferences from previous sessions.
export async function GET() {
  try {
    const rows = await db.setting.findMany()
    const settings: Record<string, any> = {}
    for (const row of rows) {
      try { settings[row.key] = JSON.parse(row.value) } catch { settings[row.key] = row.value }
    }
    return NextResponse.json({ settings })
  } catch (e: any) {
    console.error('settings get error', e)
    return NextResponse.json({ settings: {} })
  }
}

// PUT /api/settings — body: { key: value, ... } (each stored as JSON).
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const keys = Object.keys(body).slice(0, 20)
    for (const key of keys) {
      if (!/^[\w.-]{1,64}$/.test(key)) continue
      const value = JSON.stringify(body[key] ?? null)
      await db.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('settings put error', e)
    return NextResponse.json({ error: e?.message || 'Failed to save settings' }, { status: 500 })
  }
}
