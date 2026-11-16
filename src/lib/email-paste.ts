// Client-side parser for the "Paste emails" recipient workflow.
//
// People paste recipients in wildly different shapes: one per line, comma
// separated, copied out of a spreadsheet, "Name <email>", "email, Name",
// "Jane Doe, Acme Inc, jane@acme.com". This module turns all of that into the
// same validated, de-duplicated Recipient[] the CSV flow produces.

import type { Recipient } from './types'

/** Recipient with optional company metadata (display only — the API stores email + name). */
export interface PastedRecipient extends Recipient {
  company?: string
}

export interface PasteParseResult {
  /** Unique, valid recipients in first-seen order. */
  recipients: PastedRecipient[]
  /** Every syntactically valid email found in the input, before de-duplication. */
  totalFound: number
  /** How many valid emails were dropped as duplicates. */
  duplicatesRemoved: number
  /** Tokens that look like attempted email addresses but are malformed. */
  invalid: string[]
  /** How many parsed recipients came with an explicit name/company. */
  namedCount: number
}

export const MAX_RECIPIENTS = 1000

// A pragmatic email shape: local part + one or more dotted domain labels.
const EMAIL_SOURCE = "[A-Za-z0-9._%+'=~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z]{2,}"
const EMAIL_GLOBAL = new RegExp(EMAIL_SOURCE, 'g')
const EMAIL_ANCHORED = new RegExp(`^${EMAIL_SOURCE}$`, 'i')

const GENERIC_LABELS = new Set([
  'email', 'e-mail', 'mail', 'name', 'full name', 'first name', 'last name',
  'contact', 'contact name', 'company', 'company name', 'organization',
  'organisation', 'org', 'domain', 'to', 'cc', 'bcc', 'from', 'subject',
  'address', 'phone', 'title', 'role',
])

const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com',
  'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'zoho.com',
  'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru', 'hey.com',
])

const PUBLIC_SUFFIX = /\.(?:co|com|org|net|ac|gov|edu|ne|or|go)\.[a-z]{2}$/i

// Inboxes that belong to a team, not a person. "Hi Hello" is worse than
// "Hi Acme Team", so derive a team label from the company for these.
const GENERIC_LOCAL_PARTS = new Set([
  'hello', 'hi', 'hey', 'info', 'contact', 'support', 'help', 'sales', 'admin',
  'team', 'office', 'mail', 'email', 'enquiries', 'inquiries', 'billing',
  'accounts', 'accounting', 'marketing', 'careers', 'jobs', 'press', 'media',
  'pr', 'legal', 'privacy', 'security', 'noreply', 'donotreply', 'webmaster',
  'postmaster', 'feedback', 'service', 'services', 'orders', 'bookings',
  'events', 'partners',
])

export function isValidEmail(value: string): boolean {
  return EMAIL_ANCHORED.test(value.trim())
}

export function emailDomain(email: string): string {
  return (email.split('@')[1] || '').trim().toLowerCase()
}

/** "john.doe+news@acme.com" → "John Doe" — a friendly guess for empty names. */
export function deriveDisplayName(email: string): string {
  const local = (email.split('@')[0] || '').replace(/\+.*$/, '')
  if (GENERIC_LOCAL_PARTS.has(local.toLowerCase().replace(/[^a-z0-9]+/g, ''))) {
    const company = deriveCompany(email)
    if (company && company !== 'Personal' && company !== '—') return `${company} Team`
    return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase()
  }
  const words = local
    .replace(/\d+/g, ' ')
    .split(/[._-]+/)
    .map((word) => word.trim())
    .filter(Boolean)
  if (words.length === 0) return local || email
  return words
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(' ')
}

/** "jane@acme.co.uk" → "Acme". Falls back to the domain root for display. */
export function deriveCompany(email: string): string {
  const domain = emailDomain(email)
  if (!domain) return '—'
  if (CONSUMER_DOMAINS.has(domain)) return 'Personal'
  let stripped = domain.replace(/^www\./, '')
  if (PUBLIC_SUFFIX.test(stripped)) stripped = stripped.replace(PUBLIC_SUFFIX, '')
  else stripped = stripped.replace(/\.[a-z]{2,}$/i, '')
  const label = (stripped.split('.').pop() || stripped).replace(/[-_]+/g, ' ').trim()
  if (!label) return domain
  return label
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const PROSE_PREFIX = /^(?:please\s+)?(?:kindly\s+)?(?:email|e-mail|mail|contact|message|send(?:\s+an\s+email)?\s+to|reach(?:\s+out)?\s+to)\s+/i
const STOP_WORDS = new Set(['please', 'kindly', 'email', 'e-mail', 'mail', 'contact', 'message', 'send', 'reach', 'thanks', 'thank', 'regards'])

function cleanName(raw: string): string {
  const value = raw
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
    .replace(PROSE_PREFIX, '')
    .replace(/^(?:to|cc|bcc|from|name|full name|contact|contact name|company|company name|organization|organisation|org|email|e-mail|mail)\s*[:\-–—]\s*/i, '')
    .replace(/[.:;,\s|]+$/g, '')
    .replace(/^[.:;,\s|]+/g, '')
    .trim()
  if (!value || value.length > 80) return ''
  if (GENERIC_LABELS.has(value.toLowerCase())) return ''
  if (EMAIL_ANCHORED.test(value)) return ''
  if (!/[A-Za-z]/.test(value)) return ''
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(value)) return ''
  if (/^[\d\s()+\-./]+$/.test(value)) return ''
  if (STOP_WORDS.has(value.split(/\s+/)[0].toLowerCase())) return ''
  return value
}

function splitSegments(value: string): string[] {
  return value
    .split(/[,;\t|]+|\s+[–—]\s+|\s+-\s+/)
    .map(cleanName)
    .filter(Boolean)
}

function parseSingleEmailLine(line: string, email: string, start: number, rawLength: number): PastedRecipient {
  const beforeRaw = line.slice(0, start)
  const afterRaw = line.slice(start + rawLength)
  const emailLower = email.toLowerCase()

  // "Jane Doe <jane@acme.com>"
  if (/<\s*$/.test(beforeRaw)) {
    const name = cleanName(beforeRaw.replace(/<\s*$/, ''))
    let after = afterRaw
    if (/^\s*>/.test(after)) after = after.replace(/^\s*>/, '')
    const company = splitSegments(after)[0] || ''
    return {
      email: emailLower,
      name,
      ...(company && company.toLowerCase() !== name.toLowerCase() ? { company } : {}),
    }
  }

  // "Jane Doe (jane@acme.com)"
  if (/\(\s*$/.test(beforeRaw)) {
    const name = cleanName(beforeRaw.replace(/\(\s*$/, ''))
    let after = afterRaw
    if (/^\s*\)/.test(after)) after = after.replace(/^\s*\)/, '')
    const company = splitSegments(after)[0] || ''
    return {
      email: emailLower,
      name,
      ...(company && company.toLowerCase() !== name.toLowerCase() ? { company } : {}),
    }
  }

  // "jane@acme.com (Jane Doe)"
  const paren = afterRaw.match(/^\s*\(([^)]*)\)/)
  if (paren) {
    const name = cleanName(paren[1])
    const beforeParts = splitSegments(beforeRaw)
    const company = beforeParts[0] || ''
    return {
      email: emailLower,
      name,
      ...(company && company.toLowerCase() !== name.toLowerCase() ? { company } : {}),
    }
  }

  const beforeParts = splitSegments(beforeRaw)
  const afterParts = splitSegments(afterRaw)
  // Text after the email is only trusted when it was clearly delimited
  // ("email, Name"), so a sentence like "email me at jane@acme.com thanks"
  // doesn't turn "thanks" into a person's name.
  const afterIsDelimited = /^\s*[,;|\t]/.test(afterRaw) || /^\s+[–—]\s+/.test(afterRaw) || /^\s+-\s+/.test(afterRaw)

  let name = ''
  let company = ''
  if (beforeParts.length > 0) {
    name = beforeParts[0]
    company = beforeParts[1] || (afterIsDelimited ? afterParts[0] : '') || ''
  } else if (afterParts.length > 0 && afterIsDelimited) {
    name = afterParts[0]
    company = afterParts[1] || ''
  }

  return {
    email: emailLower,
    name,
    ...(company && company.toLowerCase() !== name.toLowerCase() ? { company } : {}),
  }
}

function invalidTokens(lines: string[]): string[] {
  const found = new Set<string>()
  for (const line of lines) {
    const residual = line.replace(EMAIL_GLOBAL, ' ')
    for (const token of residual.split(/[\s,;|<>()"'`]+/)) {
      const candidate = token.replace(/[.:;]+$/, '').trim()
      if (
        candidate.length > 3 &&
        candidate.length <= 120 &&
        candidate.includes('@') &&
        /\S@\S/.test(candidate) &&
        !isValidEmail(candidate)
      ) {
        found.add(candidate.toLowerCase())
      }
    }
  }
  return [...found]
}

/**
 * Parse arbitrary pasted text into unique recipients.
 * Names/companies are best-effort; emails are always validated and lowercased.
 */
export function parsePastedEmails(raw: string): PasteParseResult {
  if (!raw || !raw.trim()) {
    return { recipients: [], totalFound: 0, duplicatesRemoved: 0, invalid: [], namedCount: 0 }
  }

  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const byEmail = new Map<string, PastedRecipient>()
  let totalFound = 0

  for (const line of lines) {
    const matches = [...line.matchAll(new RegExp(EMAIL_SOURCE, 'g'))]
    if (matches.length === 0) continue
    totalFound += matches.length

    if (matches.length > 1) {
      // Multiple addresses on one line is usually a bulk dump. Split on hard
      // delimiters and keep each chunk's name when the chunk has one email
      // ("Jane <jane@x>, John <john@y>" → both names survive).
      const chunks = line.split(/[,;|]+/)
      for (const chunk of chunks) {
        const chunkMatches = [...chunk.matchAll(new RegExp(EMAIL_SOURCE, 'g'))]
        if (chunkMatches.length === 1) {
          const match = chunkMatches[0]
          const parsed = parseSingleEmailLine(chunk, match[0], match.index ?? 0, match[0].length)
          const existing = byEmail.get(parsed.email)
          if (existing) {
            if (!existing.name && parsed.name) existing.name = parsed.name
            if (!existing.company && parsed.company) existing.company = parsed.company
          } else {
            byEmail.set(parsed.email, parsed)
          }
        } else {
          for (const match of chunkMatches) {
            const email = match[0].toLowerCase()
            if (!byEmail.has(email)) byEmail.set(email, { email, name: '' })
          }
        }
      }
      continue
    }

    const match = matches[0]
    const parsed = parseSingleEmailLine(line, match[0], match.index ?? 0, match[0].length)
    const existing = byEmail.get(parsed.email)
    if (existing) {
      // A later, richer line can fill in details the first one lacked.
      if (!existing.name && parsed.name) existing.name = parsed.name
      if (!existing.company && parsed.company) existing.company = parsed.company
    } else {
      byEmail.set(parsed.email, parsed)
    }
  }

  const recipients = [...byEmail.values()]
  return {
    recipients,
    totalFound,
    duplicatesRemoved: Math.max(0, totalFound - recipients.length),
    invalid: invalidTokens(lines),
    namedCount: recipients.filter((r) => r.name).length,
  }
}

export interface MergeResult {
  recipients: Recipient[]
  added: number
  updated: number
  duplicates: number
  overflow: number
}

/**
 * Merge incoming recipients into an existing list, case-insensitive, preserving
 * the original order and filling blank names/companies instead of overwriting
 * anything the user already typed.
 */
export function mergeRecipients(
  existing: Recipient[],
  incoming: Recipient[],
  limit = MAX_RECIPIENTS,
): MergeResult {
  const byEmail = new Map<string, Recipient>()
  for (const recipient of existing) {
    const email = recipient.email.trim().toLowerCase()
    if (!email || !isValidEmail(email)) continue
    if (!byEmail.has(email)) byEmail.set(email, { ...recipient, email })
  }

  let added = 0
  let updated = 0
  let duplicates = 0
  let overflow = 0

  for (const recipient of incoming) {
    const email = recipient.email.trim().toLowerCase()
    if (!email || !isValidEmail(email)) continue
    const match = byEmail.get(email)
    if (match) {
      duplicates += 1
      let changed = false
      if (!match.name && recipient.name?.trim()) {
        match.name = recipient.name.trim()
        changed = true
      }
      if (!match.company && recipient.company?.trim()) {
        match.company = recipient.company.trim()
        changed = true
      }
      if (changed) updated += 1
      continue
    }
    if (byEmail.size >= limit) {
      overflow += 1
      continue
    }
    byEmail.set(email, {
      email,
      name: (recipient.name || '').trim(),
      ...(recipient.company?.trim() ? { company: recipient.company.trim() } : {}),
    })
    added += 1
  }

  return { recipients: [...byEmail.values()], added, updated, duplicates, overflow }
}
