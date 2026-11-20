// Small fetch helper for MailPulse API
//
// Hardened transport: every request is time-bounded (gateway never hangs the
// UI) and idempotent GETs retry ×2 with backoff on network-level failures.
// Non-GET requests never auto-retry (sends/launches aren't accidentally
// duplicated) but return the server's error message verbatim.
import type { Suggestion } from './types'

type HttpOptions = RequestInit & { timeoutMs?: number; retries?: number; skipWorkspace?: boolean }

// Best-effort reporting of browser-side failures to the persistent diagnostic
// log. Fire-and-forget; never throws and never reports the logger itself.
export function reportClientIssue(event: string, message: string, detail?: string) {
  if (typeof window === 'undefined') return
  try {
    void fetch('/api/diagnostics/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: event.slice(0, 120),
        message: message.slice(0, 4000),
        detail,
        level: 'error',
        source: 'client',
        path: window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // ignore
  }
}

function reportClientError(url: string, method: string, error: unknown, status?: number) {
  if (typeof window === 'undefined' || url.includes('/api/diagnostics/')) return
  try {
    const message = error instanceof Error ? error.message : String(error)
    const detail = error instanceof Error ? error.stack : undefined
    void fetch('/api/diagnostics/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'client_request_failed',
        message: `${method} ${url} failed${status ? ` (${status})` : ''}: ${message}`,
        detail,
        level: status && status >= 500 ? 'error' : 'warn',
        path: url,
        method,
        status: status ?? null,
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // ignore
  }
}

async function once<T>(url: string, options: HttpOptions, signal: AbortSignal): Promise<T> {
  const { skipWorkspace, ...requestOptions } = options
  const headers: Record<string, string> = {
    ...(requestOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...((requestOptions.headers as any) || {}),
  }
  if (!skipWorkspace && typeof window !== 'undefined') {
    const workspaceId = window.localStorage.getItem('mailpulse-active-workspace-id')
    if (workspaceId && !headers['X-MailPulse-Workspace-Id']) {
      headers['X-MailPulse-Workspace-Id'] = workspaceId
    }
  }
  const res = await fetch(url, { ...requestOptions, headers, signal })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = (data as any)?.error || `Request failed (${res.status})`
    const error = new Error(message) as Error & { status?: number }
    error.status = res.status
    throw error
  }
  return data as T
}

async function http<T>(url: string, options?: HttpOptions): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase()
  const timeoutMs = options?.timeoutMs ?? (method === 'GET' ? 10000 : 30000)
  const retries = options?.retries ?? (method === 'GET' ? 2 : 0)

  let lastError: any
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt)) // backoff
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      return await once<T>(url, options || {}, ac.signal)
    } catch (e: any) {
      lastError = e
      // Only network/abort failures retry; server 4xx/5xx answers surface as-is
      const retriable = e?.name === 'AbortError' || /fetch|network|aborted/i.test(String(e?.message))
      if (!retriable || attempt === retries) {
        reportClientError(url, method, e, e?.status)
        throw e?.name === 'AbortError'
          ? new Error(`Request timed out after ${timeoutMs / 1000}s`)
          : e
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}

export const api = {
  get: <T>(url: string) => http<T>(url),
  getWorkspaces: () =>
    http<{
      currentWorkspaceId: string
      workspaces: { id: string; name: string; slug: string; role: string }[]
    }>('/api/workspaces', { skipWorkspace: true }),
  getWorkspaceMembers: () =>
    http<{
      members: { id: string; email: string; role: string; createdAt: string; isCurrentUser: boolean }[]
    }>('/api/workspaces/members'),
  getWorkspaceInvitations: () =>
    http<{
      invitations: { id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null; createdAt: string }[]
    }>('/api/workspaces/invitations'),
  inviteWorkspaceMember: (email: string, role: string) =>
    http<{ invitation: { id: string; email: string; role: string; expiresAt: string }; inviteUrl: string }>(
      '/api/workspaces/invitations',
      { method: 'POST', body: JSON.stringify({ email, role }) },
    ),
  revokeWorkspaceInvitation: (id: string) =>
    http<{ ok: boolean }>('/api/workspaces/invitations?id=' + encodeURIComponent(id), { method: 'DELETE' }),
  updateWorkspaceMember: (id: string, role: string) =>
    http<{ ok: boolean; role: string }>('/api/workspaces/members', {
      method: 'PATCH',
      body: JSON.stringify({ id, role }),
    }),
  removeWorkspaceMember: (id: string) =>
    http<{ ok: boolean }>('/api/workspaces/members?id=' + encodeURIComponent(id), { method: 'DELETE' }),
  setActiveWorkspace: (workspaceId: string) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('mailpulse-active-workspace-id', workspaceId)
    }
  },
  parseCsv: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return http<any>('/api/csv/parse', { method: 'POST', body: fd })
  },
  createSession: (payload: any) =>
    http<{ session: any }>('/api/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  listSessions: (trash?: boolean) => http<{ sessions: any[] }>(`/api/sessions${trash ? '?trash=1' : ''}`),
  listTrash: () => http<{ sessions: any[] }>('/api/sessions?trash=1'),
  getSession: (id: string) => http<{ session: any; breakdown: any[] }>(`/api/sessions/${id}`),
  deleteSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  permanentDeleteSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}?permanent=1`, { method: 'DELETE' }),
  restoreSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/restore`, { method: 'POST' }),
  startSession: (id: string, smtpUser: string, smtpPass: string) =>
    http<{ ok: boolean }>(`/api/sessions/${id}/start`, { method: 'POST', body: JSON.stringify({ smtpUser, smtpPass }), timeoutMs: 65000 }),
  startSessionWithProfile: (id: string, profileId: string) =>
    http<{ ok: boolean }>(`/api/sessions/${id}/start`, { method: 'POST', body: JSON.stringify({ profileId }), timeoutMs: 65000 }),
  pauseSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/pause`, { method: 'POST' }),
  resumeSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/resume`, { method: 'POST', timeoutMs: 65000 }),
  cancelSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/cancel`, { method: 'POST' }),
  resendSession: (id: string, credentials?: { smtpUser: string; smtpPass: string }) =>
    http<{ ok: boolean; status?: string; recipientCount?: number; alreadyRunning?: boolean }>(
      `/api/sessions/${id}/resend`,
      { method: 'POST', timeoutMs: 65000, ...(credentials ? { body: JSON.stringify(credentials) } : {}) },
    ),
  duplicateSession: (id: string, name?: string) =>
    http<{ session: any }>(`/api/sessions/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ name }) }),
  resetSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/reset`, { method: 'POST' }),
  getDraft: () => http<{ draft: { content: string; updatedAt: string } | null }>('/api/wizard/draft'),
  saveDraft: (content: unknown) => http<{ ok: boolean }>('/api/wizard/draft', { method: 'PUT', body: JSON.stringify({ content: JSON.stringify(content) }) }),
  clearDraft: () => http<{ ok: boolean }>('/api/wizard/draft', { method: 'DELETE' }),
  listProfiles: () => http<{ profiles: any[] }>('/api/smtp/profiles'),
  saveProfile: (p: any) => http<{ profile: any }>('/api/smtp/profiles', { method: 'POST', body: JSON.stringify(p) }),
  updateProfile: (p: any) => http<{ profile: any }>('/api/smtp/profiles', { method: 'PATCH', body: JSON.stringify(p) }),
  deleteProfile: (id: string) => http<{ ok: boolean }>(`/api/smtp/profiles?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getSettings: () => http<{ settings: Record<string, any> }>('/api/settings'),
  saveSettings: (settings: Record<string, unknown>) => http<{ ok: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  suggest: (context: Record<string, unknown>) => http<{ suggestions: Suggestion[] }>('/api/suggest', { method: 'POST', body: JSON.stringify(context) }),
  getRecipients: (id: string, params: { status?: string; q?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams()
    if (params.status) q.set('status', params.status)
    if (params.q) q.set('q', params.q)
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    return http<{ recipients: any[]; total: number; page: number; pageSize: number }>(`/api/sessions/${id}/recipients?${q}`)
  },
  getLogs: (id: string, limit = 500) => http<{ logs: any[] }>(`/api/sessions/${id}/logs?limit=${limit}`),
  uploadAttachment: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return http<any>('/api/attachments/upload', { method: 'POST', body: fd })
  },
  deleteAttachment: (id: string) => http<{ ok: boolean }>(`/api/attachments/${id}`, { method: 'DELETE' }),
  listSignatures: () => http<{ signatures: any[] }>('/api/signatures'),
  saveSignature: (payload: { name: string; type: 'text' | 'image'; content: string }) =>
    http<{ signature: any }>('/api/signatures', { method: 'POST', body: JSON.stringify(payload) }),
  deleteSignature: (id: string) => http<{ ok: boolean }>(`/api/signatures?id=${id}`, { method: 'DELETE' }),
  listTemplates: () => http<{ templates: any[] }>('/api/templates'),
  saveTemplate: (payload: {
    name?: string; category?: string; subject: string; body: string; plainText?: string
    signatureText?: string | null; signatureImage?: string | null
    snapshot?: string | null; imageData?: string | null; imageLabel?: string | null
    fromName?: string | null; fromEmail?: string | null; providerType?: string | null
  }) => http<{ template: any }>('/api/templates', { method: 'POST', body: JSON.stringify(payload) }),
  updateTemplate: (payload: {
    id: string; name?: string; category?: string; subject?: string; body?: string; plainText?: string
    signatureText?: string | null; signatureImage?: string | null
    snapshot?: string | null; imageData?: string | null; imageLabel?: string | null
    fromName?: string | null; fromEmail?: string | null; providerType?: string | null
  }) => http<{ template: any }>('/api/templates', { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteTemplate: (id: string) => http<{ ok: boolean }>(`/api/templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testSmtp: (payload: any) => http<{ ok: boolean; message?: string; error?: string }>('/api/smtp/test', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 35000 }),
}
