import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'

export const runtime = 'nodejs'

// GET /api/smtp/profiles — saved SMTP identities. Passwords are NEVER returned.
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

// POST /api/smtp/profiles — create or update a profile (keyed by smtpUser).
// Body: { providerType, fromName, fromEmail, smtpHost?, smtpPort?, smtpSecure?, smtpUser, smtpPass? }
// Passing smtpPass stores it encrypted; omitting it keeps the existing one.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { providerType, fromName, fromEmail, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, setDefault } = body
    if (!smtpUser || !providerType) {
      return NextResponse.json({ error: 'smtpUser and providerType are required' }, { status: 400 })
    }

    const data: any = {
      name: fromEmail ? `${fromName || 'Saved'} — ${fromEmail}` : smtpUser,
      providerType,
      fromName: fromName || smtpUser.split('@')[0],
      fromEmail: fromEmail || smtpUser,
      smtpHost: smtpHost || null,
      smtpPort: smtpPort ? Number(smtpPort) : null,
      smtpSecure: !!smtpSecure,
      smtpUser,
      lastUsedAt: new Date(),
    }
    if (smtpPass) data.smtpPassEnc = encryptSecret(smtpPass)

    const existing = await db.smtpProfile.findUnique({ where: { smtpUser } })
    if (existing && !smtpPass) {
      data.smtpPassEnc = existing.smtpPassEnc
    }

    const profile = await db.smtpProfile.upsert({
      where: { smtpUser },
      update: data,
      create: { ...data, smtpPassEnc: data.smtpPassEnc || '' },
    })

    if (setDefault) {
      await db.smtpProfile.updateMany({ data: { isDefault: false } })
      await db.smtpProfile.update({ where: { id: profile.id }, data: { isDefault: true } })
    }

    const { smtpPassEnc, ...safe } = profile
    return NextResponse.json({ profile: { ...safe, hasPassword: (smtpPassEnc || existing?.smtpPassEnc || '').length > 0 } })
  } catch (e: any) {
    console.error('profiles post error', e)
    return NextResponse.json({ error: e?.message || 'Failed to save profile' }, { status: 500 })
  }
}

// DELETE /api/smtp/profiles?id=
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await db.smtpProfile.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 500 })
  }
}
