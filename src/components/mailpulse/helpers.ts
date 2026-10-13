'use client'

import type { SessionStatus, RecipientStatus, LogLevel } from '@/lib/types'

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`
}

export function formatTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', month: 'short', day: 'numeric' })
}

export function formatClock(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function duration(start: string | null, end: string | null) {
  if (!start) return '—'
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const sec = Math.max(0, Math.floor((e - s) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const r = sec % 60
  if (m < 60) return `${m}m ${r}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export const sessionStatusMeta: Record<SessionStatus, { label: string; color: string; dot: string }> = {
  draft: { label: 'Draft', color: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  queued: { label: 'Queued', color: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  running: { label: 'Running', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  paused: { label: 'Paused', color: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  completed: { label: 'Completed', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-600' },
  failed: { label: 'Failed', color: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  cancelled: { label: 'Cancelled', color: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
}

export const recipientStatusMeta: Record<RecipientStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-slate-100 text-slate-600' },
  sending: { label: 'Sending', color: 'bg-sky-50 text-sky-700' },
  sent: { label: 'Sent', color: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'Failed', color: 'bg-rose-50 text-rose-700' },
}

export const logLevelMeta: Record<LogLevel, { color: string; icon: string; label: string }> = {
  info: { color: 'text-slate-500', icon: '›', label: 'INFO' },
  success: { color: 'text-emerald-600', icon: '✓', label: 'OK' },
  warn: { color: 'text-amber-600', icon: '!', label: 'WARN' },
  error: { color: 'text-rose-600', icon: '✖', label: 'ERR' },
}
