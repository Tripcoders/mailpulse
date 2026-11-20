import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/crypto'
import { normalizeSmtpPassword, resolveSmtpSettings, smtpVerificationError } from '@/lib/smtp'
import type { ProviderType } from '@/lib/types'
import { withWorkspace } from '@/lib/workspace-context'

export const runtime = 'nodejs'
export const maxDuration = 30

const PROVIDER_TYPES: ProviderType[] = ['gmail', 'yahoo', 'outlook', 'icloud', 'zoho', 'sendgrid', 'mailgun', 'ses', 'smtp']

// POST /api/smtp/test verifies the SMTP credentials without sending an email.
// Saved credentials are decrypted only for this request and are never returned.
export const POST = withWorkspace(async (req: NextRequest) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  let profile: Awaited<ReturnType<typeof db.smtpProfile.findUnique>> = null
  if (body.profileId !== undefined) {
    const profileId = String(body.profileId || '').trim()
    if (!profileId) {
      return NextResponse.json({ ok: false, error: 'A saved sender profile is required.' }, { status: 400 })
    }
    try {
      profile = await db.smtpProfile.findUnique({ where: { id: profileId } })
    } catch {
      return NextResponse.json({ ok: false, error: 'Saved sender settings could not be loaded. Check the database connection.' }, { status: 503 })
    }
    if (!profile) {
      return NextResponse.json({ ok: false, error: 'Saved sender profile not found.' }, { status: 404 })
    }
  }

  const providerType = (profile?.providerType || body.providerType) as ProviderType | undefined
  const smtpUser = String(profile?.smtpUser || body.smtpUser || '').trim()
  const savedPassword = profile ? decryptSecret(profile.smtpPassEnc) : ''
  const rawPassword = profile ? savedPassword : String(body.smtpPass || '')
  const smtpHost = profile?.smtpHost || (typeof body.smtpHost === 'string' ? body.smtpHost : null)
  const smtpPass = providerType
    ? normalizeSmtpPassword(providerType, rawPassword, smtpHost)
    : rawPassword.trim()

  if (!providerType || !PROVIDER_TYPES.includes(providerType)) {
    return NextResponse.json({ ok: false, error: 'Choose a supported SMTP provider.' }, { status: 400 })
  }
  if (!smtpUser || !smtpPass) {
    const error = profile
      ? 'This saved sender has no usable password. Re-enter the app password and save the sender again.'
      : 'SMTP username and app password are required.'
    return NextResponse.json({ ok: false, error }, { status: 400 })
  }

  const smtpPort = profile?.smtpPort ?? (body.smtpPort === undefined ? null : Number(body.smtpPort))
  const smtpSecure = profile?.smtpSecure ?? (typeof body.smtpSecure === 'boolean' ? body.smtpSecure : null)

  let settings
  try {
    settings = resolveSmtpSettings(providerType, smtpUser, smtpHost, smtpPort, smtpSecure)
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Invalid SMTP settings.' }, { status: 400 })
  }

  const transporter = nodemailer.createTransport({
    ...settings,
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  })

  try {
    await transporter.verify()
    return NextResponse.json({ ok: true, message: 'SMTP connection verified successfully.' })
  } catch (error) {
    return NextResponse.json({ ok: false, error: smtpVerificationError(error, settings.host, settings.port) })
  } finally {
    transporter.close()
  }
})
