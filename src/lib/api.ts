// Small fetch helper for MailPulse API
//
// Hardened transport: every request is time-bounded (gateway never hangs the
// UI) and idempotent GETs retry ×2 with backoff on network-level failures.
// Non-GET requests never auto-retry (sends/launches aren't accidentally
// duplicated) but return the server's error message verbatim.
import type { Suggestion } from './types'

type HttpOptions = RequestInit & { timeoutMs?: number; retries?: number }

async function once<T>(url: string, options: HttpOptions, signal: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...((options?.headers as any) || {}),
  }
  const res = await fetch(url, { ...options, headers, signal })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as any)?.error || `Request failed (${res.status})`)
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
      if (!retriable || attempt === retries) throw e?.name === 'AbortError'
        ? new Error(`Request timed out after ${timeoutMs / 1000}s`)
        : e
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}

export const api = {
  get: <T>(url: string) => http<T>(url),
  parseCsv: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return http<any>('/api/csv/parse', { method: 'POST', body: fd })
  },
  createSession: (payload: any) =>
    http<{ session: any }>('/api/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  listSessions: () => http<{ sessions: any[] }>('/api/sessions'),
  getSession: (id: string) => http<{ session: any; breakdown: any[] }>(`/api/sessions/${id}`),
  deleteSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  startSession: (id: string, smtpUser: string, smtpPass: string) =>
    http<{ ok: boolean }>(`/api/sessions/${id}/start`, { method: 'POST', body: JSON.stringify({ smtpUser, smtpPass }) }),
  startSessionWithProfile: (id: string, profileId: string) =>
    http<{ ok: boolean }>(`/api/sessions/${id}/start`, { method: 'POST', body: JSON.stringify({ profileId }) }),
  pauseSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/pause`, { method: 'POST' }),
  resumeSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/resume`, { method: 'POST' }),
  cancelSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/cancel`, { method: 'POST' }),
  resendSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/resend`, { method: 'POST' }),
  duplicateSession: (id: string, name?: string) =>
    http<{ session: any }>(`/api/sessions/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ name }) }),
  resetSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/reset`, { method: 'POST' }),
  getDraft: () => http<{ draft: { content: string; updatedAt: string } | null }>('/api/wizard/draft'),
  saveDraft: (content: unknown) => http<{ ok: boolean }>('/api/wizard/draft', { method: 'PUT', body: JSON.stringify({ content: JSON.stringify(content) }) }),
  clearDraft: () => http<{ ok: boolean }>('/api/wizard/draft', { method: 'DELETE' }),
  listProfiles: () => http<{ profiles: any[] }>('/api/smtp/profiles'),
  saveProfile: (p: any) => http<{ profile: any }>('/api/smtp/profiles', { method: 'POST', body: JSON.stringify(p) }),
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
  saveTemplate: (payload: { name: string; subject: string; body: string }) =>
    http<{ template: any }>('/api/templates', { method: 'POST', body: JSON.stringify(payload) }),
  deleteTemplate: (id: string) => http<{ ok: boolean }>(`/api/templates?id=${id}`, { method: 'DELETE' }),
  testSmtp: (payload: any) => http<{ ok: boolean; message?: string; error?: string }>('/api/smtp/test', { method: 'POST', body: JSON.stringify(payload) }),
}
