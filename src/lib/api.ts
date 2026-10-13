// Small fetch helper for MailPulse API
async function http<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options?.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as any)?.error || `Request failed (${res.status})`)
  }
  return data as T
}

export const api = {
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
  pauseSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/pause`, { method: 'POST' }),
  resumeSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/resume`, { method: 'POST' }),
  cancelSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/cancel`, { method: 'POST' }),
  resendSession: (id: string) => http<{ ok: boolean }>(`/api/sessions/${id}/resend`, { method: 'POST' }),
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
