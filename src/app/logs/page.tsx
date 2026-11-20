'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { ArrowLeft, Copy, Download, RefreshCw, Sun, Moon, Settings, Search, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { SignOutButton } from '@/components/mailpulse/sign-out-button'

type LogEntry = {
  id: string
  workspaceId: string | null
  source: string
  level: string
  event: string
  message: string
  detail: string | null
  path: string | null
  method: string | null
  status: number | null
  createdAt: string
}

const LEVEL_STYLES: Record<string, string> = {
  error: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  warn: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  info: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function serialize(logs: LogEntry[]) {
  return logs
    .map((l) => {
      const parts = [
        `[${formatTime(l.createdAt)}]`,
        l.level.toUpperCase().padEnd(5),
        l.source.toUpperCase(),
        l.event,
      ]
      if (l.method && l.path) parts.push(`${l.method} ${l.path}`)
      if (l.status) parts.push(`HTTP ${l.status}`)
      let line = parts.join(' ') + `\n  ${l.message}`
      if (l.detail) line += `\n  DETAIL: ${l.detail.replace(/\n/g, '\n  ')}`
      return line
    })
    .join('\n\n')
}

export default function LogsPage() {
  const { theme, setTheme } = useTheme()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [level, setLevel] = useState('all')
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async (announce = false) => {
    try {
      const res = await fetch('/api/diagnostics/logs?limit=1000', { credentials: 'include', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      setLogs(Array.isArray(data.logs) ? data.logs : [])
      setError('')
      if (announce) toast.success('Logs refreshed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load logs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => void load(), 5000)
    return () => clearInterval(id)
  }, [autoRefresh, load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logs.filter((l) => {
      if (level !== 'all' && l.level !== level) return false
      if (!q) return true
      return [l.message, l.event, l.detail, l.path, l.source].some((v) => (v || '').toLowerCase().includes(q))
    })
  }, [logs, level, search])

  const copy = async () => {
    const text = serialize(filtered)
    if (!text) return toast.error('Nothing to copy')
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`Copied ${filtered.length} log entr${filtered.length === 1 ? 'y' : 'ies'}`)
    } catch {
      toast.error('Clipboard access was blocked')
    }
  }

  const download = () => {
    const text = serialize(filtered)
    if (!text) return toast.error('Nothing to export')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mailpulse-application-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('Log file exported')
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const errorCount = logs.filter((l) => l.level === 'error').length
  const warnCount = logs.filter((l) => l.level === 'warn').length

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Back to dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="font-[family-name:var(--font-jakarta)] text-xl font-bold text-foreground">Application logs</h1>
              <p className="text-xs text-muted-foreground">Errors and blockages across the whole app — view, copy, or export for support.</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Link href="/settings" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Settings">
              <Settings className="h-4 w-4" />
            </Link>
            <SignOutButton />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-4"><div className="text-2xl font-bold tabular-nums text-foreground">{logs.length}</div><div className="text-xs text-muted-foreground">Total entries</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold tabular-nums text-rose-500">{errorCount}</div><div className="text-xs text-muted-foreground">Errors</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold tabular-nums text-amber-500">{warnCount}</div><div className="text-xs text-muted-foreground">Warnings</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b py-3">
            <CardTitle className="text-sm font-medium">Log entries</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search logs…" className="h-8 w-48 pl-7 text-xs" />
              </div>
              <select value={level} onChange={(e) => setLevel(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground">
                <option value="all">All levels</option>
                <option value="error">Errors</option>
                <option value="warn">Warnings</option>
                <option value="info">Info</option>
              </select>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void load(true)} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setAutoRefresh((v) => !v)}>
                Auto: {autoRefresh ? 'on' : 'off'}
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void copy()} disabled={filtered.length === 0}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={download} disabled={filtered.length === 0}>
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {error && (
              <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
            )}
            {loading && logs.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">Loading logs…</div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                No log entries match your filters. Reproduce the issue (for example, create a campaign) and refresh.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((log) => {
                  const open = expanded.has(log.id)
                  return (
                    <div key={log.id} className="px-4 py-3">
                      <button className="flex w-full items-start gap-3 text-left" onClick={() => toggle(log.id)}>
                        <span className="mt-0.5 text-muted-foreground">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatTime(log.createdAt)}</span>
                        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${LEVEL_STYLES[log.level] || LEVEL_STYLES.info}`}>{log.level}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{log.source} · {log.event}</span>
                        <span className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{log.message}</span>
                        {log.status && <span className="shrink-0 text-[10px] text-muted-foreground">HTTP {log.status}</span>}
                      </button>
                      {open && (
                        <div className="mt-2 ml-7 space-y-1 rounded-md bg-muted/50 p-3 font-mono text-xs">
                          {log.detail ? <pre className="whitespace-pre-wrap break-all text-foreground">{log.detail}</pre> : <span className="text-muted-foreground">No additional detail.</span>}
                          {(log.path || log.method) && (
                            <div className="pt-1 text-muted-foreground">Route: {log.method || 'GET'} {log.path || '(unknown)'}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
