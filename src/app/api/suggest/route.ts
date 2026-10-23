import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * POST /api/suggest — the local smart-suggestions engine ("AI assist" that runs
 * entirely on your machine, using the database, your email account and the
 * typed content — no external API, no keys, nothing leaves this computer).
 *
 * Body: { recipientsCount, fromEmail, providerType, subject, bodyHtml,
 *         batchSize, batchDelayMs, perEmailDelayMs, attachmentsTotalMB }
 * → { suggestions: [{ id, kind, title, detail, apply? }] }
 */

// Per-provider sending limits & pacing advice (approximate public limits).
const LIMITS: Record<string, { daily: number; batch: number; batchDelay: number; perEmail: number }> = {
  gmail:    { daily: 500,  batch: 8,  batchDelay: 4000, perEmail: 900 },
  yahoo:    { daily: 300,  batch: 6,  batchDelay: 5000, perEmail: 1200 },
  outlook:  { daily: 300,  batch: 6,  batchDelay: 5000, perEmail: 1000 },
  icloud:   { daily: 200,  batch: 5,  batchDelay: 6000, perEmail: 1200 },
  zoho:     { daily: 400,  batch: 8,  batchDelay: 4000, perEmail: 900 },
  sendgrid: { daily: 2000, batch: 25, batchDelay: 1000, perEmail: 150 },
  mailgun:  { daily: 2000, batch: 25, batchDelay: 1000, perEmail: 150 },
  ses:      { daily: 2000, batch: 25, batchDelay: 1000, perEmail: 150 },
  smtp:     { daily: 0,    batch: 10, batchDelay: 2000, perEmail: 500 },
}

// Maps an email domain to the matching provider preset.
const DOMAIN_PROVIDER: { test: RegExp; value: string }[] = [
  { test: /@gmail\.com$/i, value: 'gmail' },
  { test: /@(googlemail|google)\.com$/i, value: 'gmail' },
  { test: /@yahoo\.(com|co\.uk|ca|fr)$/i, value: 'yahoo' },
  { test: /@outlook\.(com|live)|@hotmail\.(com|co\.uk)|@live\.com/i, value: 'outlook' },
  { test: /@icloud\.com|@me\.com|@mac\.com/i, value: 'icloud' },
  { test: /@zoho\.(com|eu|in)$/i, value: 'zoho' },
  { test: /@sendgrid/i, value: 'sendgrid' },
  { test: /@mailgun/i, value: 'mailgun' },
  { test: /@amazonaws\.com$/i, value: 'ses' },
]

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      recipientsCount = 0,
      fromEmail = '',
      providerType = '',
      subject = '',
      bodyHtml = '',
      batchSize = 0,
      batchDelayMs = 0,
      perEmailDelayMs = 0,
      attachmentsTotalMB = 0,
      currentStep = 0,
    } = body

    const suggestions: any[] = []
    const email = String(fromEmail).trim()

    // Smart preset from DB — the last/default remembered profile.
    const defaultProfile = await db.smtpProfile.findFirst({
      where: { isDefault: true, smtpPassEnc: { not: '' } },
      orderBy: { lastUsedAt: 'desc' },
    }).catch(() => null)
    if (defaultProfile && String(providerType || '').toLowerCase() !== defaultProfile.providerType) {
      suggestions.push({
        id: 'use-default-profile',
        kind: 'profile',
        title: `Use your saved ${defaultProfile.providerType.toUpperCase()} identity`,
        detail: `Sender "${defaultProfile.fromName}" <${defaultProfile.fromEmail}> with the remembered password — one click, no retyping.`,
        apply: {
          type: 'profile',
          profileId: defaultProfile.id,
          providerType: defaultProfile.providerType,
          fromName: defaultProfile.fromName,
          fromEmail: defaultProfile.fromEmail,
          smtpHost: defaultProfile.smtpHost,
          smtpPort: defaultProfile.smtpPort,
          smtpSecure: defaultProfile.smtpSecure,
          smtpUser: defaultProfile.smtpUser,
        },
      })
    }

    // Provider auto-detect from the typed email domain.
    if (email && providerType) {
      const match = DOMAIN_PROVIDER.find((d) => d.test.test(email))
      if (match && match.value !== providerType) {
        const provs: Record<string, { label: string; host: string; port: number; secure: boolean }> = {
          gmail: { label: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true },
          yahoo: { label: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 465, secure: true },
          outlook: { label: 'Outlook', host: 'smtp.office365.com', port: 587, secure: false },
          icloud: { label: 'iCloud', host: 'smtp.mail.me.com', port: 587, secure: false },
          zoho: { label: 'Zoho', host: 'smtp.zoho.com', port: 465, secure: true },
        }
        const p = provs[match.value]
        if (p) {
          suggestions.push({
            id: 'provider-from-domain',
            kind: 'provider',
            title: `Switch to ${p.label} SMTP`,
            detail: `${email} is a ${p.label} address, but "${providerType}" is selected. ${p.label} uses ${p.host}:${p.port}.`,
            apply: { type: 'provider', providerType: match.value, smtpHost: p.host, smtpPort: String(p.port), smtpSecure: p.secure },
          })
        }
      }
    }

    // Content suggestions.
    if (bodyHtml && recipientsCount > 0) {
      const hasNameVar = /\{\{\s*name\s*\}\}/i.test(bodyHtml + ' ' + subject)
      if (!hasNameVar) {
        suggestions.push({
          id: 'personalize',
          kind: 'content',
          title: 'Personalize with {{name}}',
          detail: 'Your email has no variables. Adding "Hi {{name}}" typically boosts opens and reduces spam reports.',
        })
      }
      const plainLen = bodyHtml.replace(/<[^>]*>/g, '').trim().length
      if (plainLen > 900) {
        suggestions.push({
          id: 'long-body',
          kind: 'content',
          title: 'Long body — consider the inline summary',
          detail: `${plainLen} characters. Keep the top 2–3 sentences as the key message; bulk clients truncate previews after ~600.`,
        })
      }
      if (!/<img[^>]+src=["']https?:/i.test(bodyHtml)) {
        suggestions.push({
          id: 'add-visual',
          kind: 'content',
          title: 'Add a header image',
          detail: 'Emails with one image typically get higher engagement. A single image near the top is enough.',
        })
      }
    }
    if (subject && !/\{\{\s*name\s*\}\}|%|\d/.test(subject) && recipientsCount > 0) {
      suggestions.push({
        id: 'subject-spark',
        kind: 'content',
        title: 'Make the subject pop',
        detail: `Try one of: "${subject.split(' ').slice(0, 4).join(' ')} — for {{first_name}}", "${subject} (this week)", or add {{name}}.`,
      })
    }

    // Throttling vs provider limits.
    const limit = LIMITS[String(providerType).toLowerCase()]
    if (recipientsCount > 0 && limit) {
      if (recipientsCount > limit.daily && limit.daily > 0) {
        suggestions.push({
          id: 'daily-limit',
          kind: 'throttle',
          title: `Over ${providerType?.toUpperCase()}'s daily limit`,
          detail: `${recipientsCount} recipients vs ~${limit.daily}/day. Send in <${limit.daily} chunks or use a transactional SMTP.`,
        })
      }
      if (batchSize > 0 && (batchSize > limit.batch || batchDelayMs && batchDelayMs < limit.batchDelay || perEmailDelayMs && perEmailDelayMs < limit.perEmail)) {
        suggestions.push({
          id: 'pacing',
          kind: 'throttle',
          title: 'Tighten the send pace for this provider',
          detail: `Recommended for ${providerType?.toUpperCase()}: batches of ${limit.batch}, ${limit.batchDelay}ms between batches, ${limit.perEmail}ms per email.`,
          apply: { type: 'throttle', batchSize: String(limit.batch), batchDelayMs: String(limit.batchDelay), perEmailDelayMs: String(limit.perEmail) },
        })
      }
    }

    // Attachments weight warning.
    if (attachmentsTotalMB > 10) {
      suggestions.push({
        id: 'heavy-attachments',
        kind: 'content',
        title: 'Heavy attachments',
        detail: `${attachmentsTotalMB}MB total. Providers often reject >25MB — consider a Dropbox/Drive link instead.`,
      })
    }

    return NextResponse.json({ suggestions })
  } catch (e: any) {
    console.error('suggest error', e)
    return NextResponse.json({ suggestions: [] })
  }
}
