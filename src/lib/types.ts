// Shared types for MailPulse frontend

export type SessionStatus =
  | 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export type ProviderType = 'gmail' | 'yahoo' | 'outlook' | 'icloud' | 'zoho' | 'sendgrid' | 'mailgun' | 'ses' | 'smtp'

export type RecipientStatus = 'pending' | 'sending' | 'sent' | 'failed'

export type LogLevel = 'info' | 'success' | 'warn' | 'error'

export interface Recipient {
  email: string
  name: string
}

export interface ParsedCsv {
  recipients: Recipient[]
  totalRows: number
  duplicatesRemoved: number
  invalid: number
  headers: string[]
  detectedEmailColumn: string
  detectedNameColumn: string | null
}

export interface StagedAttachment {
  stagingId: string
  filename: string
  filepath: string
  mimetype: string
  size: number
}

// Suggestion returned by the local smart-suggestions engine (/api/suggest).
export interface Suggestion {
  id: string
  kind: 'profile' | 'provider' | 'content' | 'throttle'
  title: string
  detail: string
  apply?: Record<string, any>
}

export interface SessionSummary {
  id: string
  name: string
  status: SessionStatus
  totalEmails: number
  sentCount: number
  failedCount: number
  pendingCount: number
  fromName: string
  fromEmail: string
  providerType: ProviderType
  subject: string
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface SessionDetail extends SessionSummary {
  smtpHost: string | null
  smtpPort: number | null
  smtpSecure: boolean | null
  bodyHtml: string
  plainText: string | null
  signatureText: string | null
  signatureImage: string | null
  batchSize: number
  batchDelayMs: number
  perEmailDelayMs: number
  updatedAt: string
}

export interface Attachment {
  id: string
  sessionId: string
  filename: string
  filepath: string
  mimetype: string
  size: number
  createdAt: string
}

export interface Signature {
  id: string
  name: string
  type: 'text' | 'image'
  content: string
  createdAt: string
}

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
  createdAt: string
}

export interface LogEntry {
  level: LogLevel
  message: string
  recipient?: string | null
  timestamp: string
}

export interface RecipientRecord {
  id: string
  sessionId: string
  email: string
  name: string
  status: RecipientStatus
  error: string | null
  attemptCount: number
  sentAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProgressPayload {
  id: string
  status: SessionStatus
  totalEmails: number
  sentCount: number
  failedCount: number
  pendingCount: number
  startedAt: string | null
  completedAt: string | null
}
