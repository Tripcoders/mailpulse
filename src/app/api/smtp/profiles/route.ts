import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'

export const runtime = 'nodejs'

// GET /api/smtp/profiles — saved senders. Passwords are NEVER returned.
export async function GET() {
  try {
    const profiles = await db.smtpProfile.findMany({
      orderBy: [{ isDefault: 'desc' }, { lastUsedAt: 'desc' }],
    })
    return NextResponse.json({
      profiles: profiles.map(({ smtpPassEnc, ...p }) => ({
        ...p,
        hasPassword: smtpPassEnc.length > 0,
      })),
    })
  } catch (e: any) {
    console.error('profiles get error', e)
    return NextResponse.json({ profiles: [] })
  }
}

// POST /api/smtp/profiles — create or update a saved sender.
// Body: { id?, name?, providerType, fromName, fromEmail, smtpHost?,
//         smtpPort?, smtpSecure?, smtpUser, smtpPass?, setDefault? }
// Passing smtpPass stores it encrypted; omitting it keeps the existing password.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, name, providerType, fromName, fromEmail, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, setDefault } = body
    if (!smtpUser || !providerType) {
      return NextResponse.json({ error: 'smtpUser and providerType are required' }, { status: 400 })
    }

    const existingById = id
      ? await db.smtpProfile.findUnique({ where: { id: String(id) } })
      : null
    const existingByUser = await db.smtpProfile.findUnique({ where: { smtpUser: String(smtpUser) } })

    // Changing the login of one sender must not collide with another sender.
    if (existingById && existingByUser && existingByUser.id !== existingById.id) {
      return NextResponse.json(
        { error: 'That SMTP username is already saved on another sender. Open that sender instead, or use a different username.' },
        { status: 409 },
      )
    }

    const data: any = {
      name: String(name || '').trim() || existingById?.name || `${fromName || 'Saved sender'} — ${fromEmail || smtpUser}`,
      providerType,
      fromName: fromName || smtpUser.split('@')[0],
      fromEmail: fromEmail || smtpUser,
      smtpHost: smtpHost || null,
      smtpPort: smtpPort ? Number(smtpPort) : null,
      smtpSecure: !!smtpSecure,
      smtpUser,
      lastUsedAt: new Date(),
    }
    if (smtpPass) data.smtpPassEnc = encryptSecret(String(smtpPass))

    let profile
    if (existingById) {
      if (!smtpPass) data.smtpPassEnc = existingById.smtpPassEnc
      profile = await db.smtpProfile.update({ where: { id: existingById.id }, data })
    } else {
      if (existingByUser && !smtpPass) data.smtpPassEnc = existingByUser.smtpPassEnc
      profile = await db.smtpProfile.upsert({
        where: { smtpUser: String(smtpUser) },
        update: data,
        create: { ...data, smtpPassEnc: data.smtpPassEnc || '' },
      })
    }

    // Every explicit save makes this the default sender, unless the caller
    // asks otherwise (used when updating a secondary sender).
    if (setDefault !== false) {
      await db.smtpProfile.updateMany({ data: { isDefault: false } })
      profile = await db.smtpProfile.update({ where: { id: profile.id }, data: { isDefault: true } })
    }

    const { smtpPassEnc, ...safe } = profile
    return NextResponse.json({ profile: { ...safe, hasPassword: smtpPassEnc.length > 0 } })
  } catch (e: any) {
    console.error('profiles post error', e)
    return NextResponse.json({ error: e?.message || 'Failed to save profile' }, { status: 500 })
  }
}

// PATCH /api/smtp/profiles — rename, make default, or revoke the stored password.
// Body: { id, name?, isDefault?, clearPassword? }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const existing = await db.smtpProfile.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Saved sender not found' }, { status: 404 })

    const data: any = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
    if (body.clearPassword) data.smtpPassEnc = ''

    let profile = Object.keys(data).length
      ? await db.smtpProfile.update({ where: { id }, data })
      : existing

    if (body.isDefault) {
      await db.smtpProfile.updateMany({ data: { isDefault: false } })
      profile = await db.smtpProfile.update({ where: { id }, data: { isDefault: true } })
    }

    const { smtpPassEnc, ...safe } = profile
    return NextResponse.json({ profile: { ...safe, hasPassword: smtpPassEnc.length > 0 } })
  } catch (e: any) {
    console.error('profiles patch error', e)
    return NextResponse.json({ error: e?.message || 'Failed to update sender' }, { status: 500 })
  }
}

// DELETE /api/smtp/profiles?id=
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const existing = await db.smtpProfile.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ ok: true })

    await db.smtpProfile.delete({ where: { id } })

    // Never leave the list without a default when another sender still exists.
    if (existing.isDefault) {
      const next = await db.smtpProfile.findFirst({ orderBy: { lastUsedAt: 'desc' } })
      if (next) await db.smtpProfile.update({ where: { id: next.id }, data: { isDefault: true } })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 500 })
  }
}
