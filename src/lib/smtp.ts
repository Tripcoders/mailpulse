import type { ProviderType } from './types'

type SmtpSettings = { host: string; port: number; secure: boolean }

const PROVIDER_SETTINGS: Partial<Record<ProviderType, SmtpSettings>> = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
  outlook: { host: 'smtp.office365.com', port: 587, secure: false },
  icloud: { host: 'smtp.mail.me.com', port: 587, secure: false },
  zoho: { host: 'smtp.zoho.com', port: 465, secure: true },
  sendgrid: { host: 'smtp.sendgrid.net', port: 587, secure: false },
  mailgun: { host: 'smtp.mailgun.org', port: 587, secure: false },
  ses: { host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: false },
}

export function normalizeSmtpPassword(providerType: ProviderType, password: string, smtpHost?: string | null) {
  const trimmed = password.trim()
  // Google displays app passwords in four-character groups. Spaces copied
  // from that display are separators, not part of the SMTP password.
  const host = smtpHost?.trim().toLowerCase().replace(/\.$/, '')
  const isGmail = providerType === 'gmail' || host === 'smtp.gmail.com' || host === 'smtp.googlemail.com'
  return isGmail ? trimmed.replace(/\s+/g, '') : trimmed
}

export function resolveSmtpSettings(
  providerType: ProviderType,
  smtpUser: string,
  smtpHost?: string | null,
  smtpPort?: number | null,
  smtpSecure?: boolean | null,
): SmtpSettings {
  let resolvedType = providerType
  const host = smtpHost?.trim() || ''

  if (providerType === 'smtp' && !host) {
    const domain = smtpUser.split('@')[1]?.toLowerCase() || ''
    if (domain.includes('gmail')) resolvedType = 'gmail'
    else if (domain.includes('yahoo')) resolvedType = 'yahoo'
    else if (domain.includes('outlook') || domain.includes('hotmail') || domain.includes('live')) resolvedType = 'outlook'
    else if (domain.includes('icloud') || domain.includes('me.com')) resolvedType = 'icloud'
    else if (domain.includes('zoho')) resolvedType = 'zoho'
  }

  const preset = PROVIDER_SETTINGS[resolvedType]
  if (preset) return preset

  if (!host) {
    throw new Error('Enter the SMTP server address for your custom provider.')
  }
  if (/\s|\/|@/.test(host) || host.length > 253) {
    throw new Error('Enter a valid SMTP hostname without a protocol, path, or username.')
  }

  const port = smtpPort ?? 587
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Enter an SMTP port between 1 and 65535.')
  }

  return { host, port, secure: smtpSecure ?? false }
}

export function smtpVerificationError(error: unknown, host: string, port: number) {
  const detail = error as { code?: string; responseCode?: number }
  const code = String(detail?.code || '')

  if (code === 'EAUTH' || detail?.responseCode === 535) {
    return 'SMTP authentication failed. Check the full email address and app password. Gmail app-password spaces are removed automatically; the password must still be active.'
  }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `The SMTP hostname ${host} could not be resolved. Check the server address.`
  }

  if (['ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'ESOCKET', 'EHOSTUNREACH'].includes(code)) {
    return `Could not connect to ${host}:${port}. Check the host, port, TLS setting, and outbound network access.`
  }

  return `SMTP verification failed${code ? ` (${code})` : ''}. Check the provider settings and app password.`
}
