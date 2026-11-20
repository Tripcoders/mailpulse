import nodemailer, { type Transporter } from 'nodemailer'
import type { ProviderType } from '@/lib/types'
import { resolveSmtpSettings } from '@/lib/smtp'

export type CampaignMailSettings = {
  fromName: string
  fromEmail: string
  providerType: string
  smtpHost: string | null
  smtpPort: number | null
  smtpSecure: boolean | null
  subject: string
  bodyHtml: string
  plainText: string | null
  signatureText: string | null
  signatureImage: string | null
}

export type CampaignRecipient = { email: string; name: string }

export function createCampaignTransporter(
  session: Pick<CampaignMailSettings, 'providerType' | 'smtpHost' | 'smtpPort' | 'smtpSecure'>,
  smtpUser: string,
  smtpPass: string,
): { transporter: Transporter; host: string; port: number } {
  const settings = resolveSmtpSettings(
    session.providerType as ProviderType,
    smtpUser,
    session.smtpHost,
    session.smtpPort,
    session.smtpSecure,
  )

  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  })

  return { transporter, host: settings.host, port: settings.port }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function personalize(template: string, recipient: CampaignRecipient, escapeValues = false) {
  const name = recipient.name.trim()
  const values = {
    name,
    first_name: name.split(/\s+/)[0] || '',
    email: recipient.email,
  }
  const safe = (value: string) => escapeValues ? escapeHtml(value) : value

  return template
    .replace(/\{\{\s*name\s*\}\}/gi, safe(values.name))
    .replace(/\{\{\s*first_name\s*\}\}/gi, safe(values.first_name))
    .replace(/\{\{\s*email\s*\}\}/gi, safe(values.email))
}

export function buildCampaignMessage(session: CampaignMailSettings, recipient: CampaignRecipient) {
  let html = personalize(session.bodyHtml, recipient, true)
  if (session.signatureText) {
    html += `\n<div style="margin-top:24px;font-size:14px;color:#475569;white-space:pre-wrap;border-top:1px solid #e2e8f0;padding-top:12px">${escapeHtml(session.signatureText)}</div>`
  }
  if (session.signatureImage) {
    html += `\n<div style="margin-top:12px"><img src="${session.signatureImage}" alt="signature" style="max-height:90px;max-width:320px"/></div>`
  }

  const subject = personalize(session.subject, recipient)
  const textTemplate = session.plainText || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const text = personalize(textTemplate, recipient)
  const fromName = session.fromName.trim() || session.fromEmail.split('@')[0]

  return {
    from: { name: fromName, address: session.fromEmail },
    to: recipient.name.trim()
      ? { name: recipient.name.trim(), address: recipient.email }
      : recipient.email,
    subject,
    html,
    text,
  }
}
