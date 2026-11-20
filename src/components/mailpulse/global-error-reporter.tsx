'use client'

import { useEffect } from 'react'

function report(event: string, message: string, detail?: string) {
  if (typeof window === 'undefined') return
  try {
    void fetch('/api/diagnostics/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        message,
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

/** Captures browser exceptions and unhandled promise rejections into AppLog. */
export function GlobalErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      report(
        'client_uncaught_error',
        event.message || 'Uncaught browser error',
        `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}\n${event.error?.stack || ''}`,
      )
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message = reason instanceof Error ? reason.message : String(reason)
      const detail = reason instanceof Error ? reason.stack : undefined
      report('client_unhandled_rejection', message, detail)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
