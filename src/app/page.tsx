'use client'

import { useEffect, useState, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { toast } from 'sonner'
import {
  Plus, Mail, Clock, CheckCircle2, AlertCircle, History,
  Sun, Moon, Search, Zap, ShieldCheck, BarChart3, Send, ColorPicker,
  Copy, RefreshCw, Sparkles, Server,
} from '@/components/mailpulse/icons'
import { useTheme } from 'next-themes'
import { api } from '@/lib/api'
import { Wizard } from '@/components/mailpulse/wizard'
import { SessionView } from '@/components/mailpulse/session-view'
import { SignOutButton } from '@/components/mailpulse/sign-out-button'
import { WorkspaceSwitcher } from '@/components/mailpulse/workspace-switcher'
import { sessionStatusMeta, formatTime } from '@/components/mailpulse/helpers'
import type { SessionSummary } from '@/lib/types'

type BackendHealth = {
  ok?: boolean
  app?: string
  db?: string
  engine?: string
  auth?: string
  smtpProfileEncryption?: string
  engineControlAuth?: string
  senderMode?: 'vercel-queue' | 'persistent-worker'
  queueSchema?: string
  checkedAt?: string
}

type EngineDiagnostics = {
  status: 'ok' | 'down' | 'unverified'
  code: string
  message: string
  configured: boolean
  controlTokenConfigured: boolean
  controlTokenRequired?: boolean
  mode?: 'vercel-queue' | 'persistent-worker'
  queueSchemaReady?: boolean | null
  checkedAt: string
  httpStatus?: number
  worker?: {
    database?: string
    recovery?: string
    lease?: string
    controlAuth?: string
  }
  repairSteps: string[]
}

function displayHealthStatus(status?: string) {
  if (status === 'ok' || status === 'ready' || status === 'held') return 'Ready'
  if (status === 'unverified') return 'Not verified'
  if (status === 'down' || status === 'degraded' || status === 'waiting' || status === 'unavailable') return 'Down'
  if (status === 'missing' || status === 'misconfigured') return 'Needs setup'
  if (status === 'not_checked') return 'Not checked'
  return 'Checking'
}

function healthStatusClass(status?: string) {
  if (status === 'ok' || status === 'ready' || status === 'held') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }
  if (status === 'unknown' || status === 'not_checked' || !status) {
    return 'border-border bg-muted/50 text-muted-foreground'
  }
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
}

function createAiRepairBrief(health: BackendHealth | null, diagnostics: EngineDiagnostics | null) {
  const worker = diagnostics?.worker
  const queueMode = diagnostics?.mode === 'vercel-queue' || health?.senderMode === 'vercel-queue'
  const lines = [
    'Help diagnose and repair MailPulse using this redacted backend report.',
    `Checked at: ${diagnostics?.checkedAt || health?.checkedAt || 'not available'}`,
    `Application: ${health?.app || 'unknown'}`,
    `Neon database: ${health?.db || 'unknown'}`,
    `Sender mode: ${queueMode ? 'Vercel Queues' : 'persistent worker'}`,
    `Sender status: ${diagnostics?.status || health?.engine || 'unknown'}`,
    `Sender diagnosis: ${diagnostics?.code || 'not_run'} — ${diagnostics?.message || 'No detailed sender probe has run yet.'}`,
    'Do not request or expose database URLs, API tokens, SMTP passwords, or recipient addresses. Do not send emails or deploy changes automatically.',
  ]

  if (queueMode) {
    lines.push(
      `Campaign queue schema ready: ${diagnostics?.queueSchemaReady === undefined ? health?.queueSchema || 'not checked' : diagnostics.queueSchemaReady === null ? 'not available' : diagnostics.queueSchemaReady ? 'yes' : 'no'}`,
      'Persistent sender URL and worker control token: not required in Vercel Queues mode.',
    )
  } else {
    lines.push(
      `Sender URL configured: ${diagnostics?.configured === undefined ? 'not checked' : diagnostics.configured ? 'yes' : 'no'}`,
      `Worker control token configured: ${diagnostics?.controlTokenConfigured === undefined ? 'not checked' : diagnostics.controlTokenConfigured ? 'yes' : 'no'}`,
      `Worker readiness: database=${worker?.database || 'not reported'}, recovery=${worker?.recovery || 'not reported'}, lease=${worker?.lease || 'not reported'}, controlAuth=${worker?.controlAuth || 'not reported'}`,
    )
  }

  if (diagnostics?.repairSteps.length) {
    lines.push('Suggested repair steps:', ...diagnostics.repairSteps.map((step, index) => `${index + 1}. ${step}`))
  }

  return lines.join('\n')
}

export default function Home() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [view, setView] = useState<'wizard' | 'session'>('wizard')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [wizardKey, setWizardKey] = useState(0)
  const [campaignModalOpen, setCampaignModalOpen] = useState(false)
  const [newCampaignName, setNewCampaignName] = useState('')
  const [newCampaignColor, setNewCampaignColor] = useState('#3b82f6')
  const [newCampaignCategory, setNewCampaignCategory] = useState('General')
  const [wizardInitialName, setWizardInitialName] = useState('')
  const [wizardInitialColor, setWizardInitialColor] = useState('#3b82f6')
  const [wizardInitialCategory, setWizardInitialCategory] = useState('General')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const [health, setHealth] = useState<BackendHealth | null>(null)
  const [engineDiagnostics, setEngineDiagnostics] = useState<EngineDiagnostics | null>(null)
  const [engineDialogOpen, setEngineDialogOpen] = useState(false)
  const [checkingDiagnostics, setCheckingDiagnostics] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Stack health indicator — surfaces degraded services before the user hits them
  useEffect(() => {
    let alive = true
    const tick = () => fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()).then((h) => {
      if (alive) setHealth({ ...h, checkedAt: h.checkedAt || new Date().toISOString() })
    }).catch(() => {})
    tick()
    const i = setInterval(tick, 12000)
    return () => { alive = false; clearInterval(i) }
  }, [])

  const runBackendDiagnostics = useCallback(async (announce = true) => {
    setCheckingDiagnostics(true)
    try {
      const [healthResult, engineResult] = await Promise.all([
        fetch('/api/health', { cache: 'no-store' }).then(async (response) => response.json().catch(() => null)),
        fetch('/api/engine/diagnostics', { cache: 'no-store' }).then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => null) })).catch(() => null),
      ])

      if (healthResult) {
        setHealth({ ...healthResult, checkedAt: healthResult.checkedAt || new Date().toISOString() })
      }
      const diagnostic = engineResult?.data as EngineDiagnostics | null
      if (diagnostic) {
        setEngineDiagnostics(diagnostic)
        setHealth((current) => current
          ? { ...current, engine: diagnostic.status, senderMode: diagnostic.mode || current.senderMode, queueSchema: diagnostic.queueSchemaReady === undefined ? current.queueSchema : diagnostic.queueSchemaReady ? 'ok' : diagnostic.queueSchemaReady === false ? 'missing' : 'unavailable', checkedAt: diagnostic.checkedAt }
          : { app: 'unknown', db: 'unknown', engine: diagnostic.status, senderMode: diagnostic.mode, queueSchema: diagnostic.queueSchemaReady === true ? 'ok' : diagnostic.queueSchemaReady === false ? 'missing' : 'unavailable', checkedAt: diagnostic.checkedAt })
      }

      if (announce) {
        if (healthResult?.db === 'ok' && diagnostic?.status === 'ok') {
          toast.success(diagnostic.mode === 'vercel-queue'
            ? 'Vercel Queue mode and database schema are ready. No email was sent.'
            : 'Backend checks passed. The sender is ready.')
        } else {
          toast.error(diagnostic?.message || 'Some backend services still need attention.')
        }
      }
    } catch {
      if (announce) toast.error('Could not read the backend diagnostics. Try again in a moment.')
    } finally {
      setCheckingDiagnostics(false)
    }
  }, [])

  const copyAiRepairBrief = async () => {
    try {
      await navigator.clipboard.writeText(createAiRepairBrief(health, engineDiagnostics))
      toast.success('Redacted repair brief copied for your AI assistant.')
    } catch {
      toast.error('Clipboard access was blocked. Try copying from the diagnostic details.')
    }
  }

  const loadSessions = useCallback(async () => {
    try {
      const data = await (showTrash ? api.listTrash() : api.listSessions())
      setSessions(data.sessions as SessionSummary[])
    } catch {
      // ignore
    } finally {
      setLoadingList(false)
    }
  }, [showTrash])

  useEffect(() => {
    loadSessions()
    // refresh history periodically
    const i = setInterval(loadSessions, 8000)
    return () => clearInterval(i)
  }, [loadSessions])

  const newCampaign = () => {
    setNewCampaignName('')
    setNewCampaignColor('#3b82f6')
    setNewCampaignCategory('General')
    setCampaignModalOpen(true)
  }
  const createCampaign = () => {
    setWizardInitialName(newCampaignName)
    setWizardInitialColor(newCampaignColor)
    setWizardInitialCategory(newCampaignCategory)
    setSelectedId(null)
    setWizardKey((k) => k + 1)
    setView('wizard')
    setCampaignModalOpen(false)
  }
  const openSession = (id: string) => {
    setSelectedId(id)
    setView('session')
  }
  const onLaunched = (id: string) => {
    setSelectedId(id)
    setView('session')
    loadSessions()
  }
  const onDeleted = () => {
    setSelectedId(null)
    setView('wizard')
    loadSessions()
  }

  const filtered = sessions.filter((s) =>
    !filter || s.name.toLowerCase().includes(filter.toLowerCase()) || s.subject.toLowerCase().includes(filter.toLowerCase()) || s.fromEmail.toLowerCase().includes(filter.toLowerCase())
  )

  const totalSent = sessions.reduce((a, s) => a + s.sentCount, 0)
  const totalAll = sessions.reduce((a, s) => a + s.totalEmails, 0)
  const activeCount = sessions.filter((s) => s.status === 'running' || s.status === 'paused' || s.status === 'queued').length
  const diagnosticIsFresh = engineDiagnostics && Date.now() - new Date(engineDiagnostics.checkedAt).getTime() < 30000
  const visibleEngineStatus = diagnosticIsFresh ? engineDiagnostics.status : health?.engine
  const senderMode = diagnosticIsFresh ? engineDiagnostics?.mode || health?.senderMode : health?.senderMode
  const queueMode = senderMode === 'vercel-queue'
  const headerStatusLabel = !health
    ? 'Checking services…'
    : visibleEngineStatus !== 'ok'
      ? queueMode
        ? visibleEngineStatus === 'unverified' ? 'Queue unverified' : 'Queue setup needed'
        : 'Engine down'
      : health.db !== 'ok'
        ? 'Database down'
        : health.auth === 'missing'
          ? 'Auth setup needed'
          : health.smtpProfileEncryption === 'missing'
            ? 'SMTP key missing'
            : !queueMode && health.engineControlAuth === 'missing'
              ? 'Engine token missing'
              : queueMode && health.queueSchema !== 'ok'
                ? 'Queue setup needed'
              : health.ok === false
                ? 'Backend needs attention'
                : queueMode ? 'Queue mode' : 'All systems go'
  const headerStatusReady = Boolean(health?.ok !== false && health?.db === 'ok' && visibleEngineStatus === 'ok')
  const queueSchemaStatus = engineDiagnostics?.queueSchemaReady === true || health?.queueSchema === 'ok'
    ? 'ok'
    : engineDiagnostics?.queueSchemaReady === false || health?.queueSchema === 'missing'
      ? 'missing'
      : engineDiagnostics?.queueSchemaReady === null || health?.queueSchema === 'unavailable'
        ? 'unavailable'
      : 'not_checked'
  const deliveryRows = queueMode
    ? [
        { label: 'Campaign delivery', status: engineDiagnostics?.status || health?.engine || 'unknown', detail: engineDiagnostics?.message || 'Vercel Queues is selected; the old sender host is not used.' },
        { label: 'Queue database schema', status: queueSchemaStatus, detail: 'Neon needs queue state, recipient claims, and encrypted temporary credential storage.' },
      ]
    : [
        { label: 'Sender engine', status: engineDiagnostics?.status || health?.engine || 'unknown', detail: engineDiagnostics?.message || 'Run diagnostics to get a specific sender failure reason.' },
        { label: 'Sender URL', status: engineDiagnostics ? engineDiagnostics.configured ? 'ok' : 'missing' : 'not_checked', detail: engineDiagnostics?.configured ? 'A server-side sender URL is configured; its value is never shown here.' : 'No sender URL configuration has been confirmed.' },
        { label: 'Worker control token', status: engineDiagnostics ? engineDiagnostics.controlTokenConfigured ? 'ok' : 'missing' : health?.engineControlAuth || 'not_checked', detail: 'The app and worker must share the same server-side control token.' },
      ]
  const diagnosticRows = [
    { label: 'MailPulse app', status: health?.app || 'unknown', detail: 'The web application and health endpoint.' },
    { label: 'Neon database', status: health?.db || 'unknown', detail: 'Campaign records and worker data store.' },
    ...deliveryRows,
    { label: 'Neon Auth', status: health?.auth || 'not_checked', detail: 'Authentication configuration for workspace access.' },
    { label: 'SMTP encryption key', status: health?.smtpProfileEncryption || 'not_checked', detail: 'Stable server-side key used to encrypt saved sender passwords.' },
  ]
  const repairSteps = engineDiagnostics?.repairSteps?.length
    ? engineDiagnostics.repairSteps
    : queueMode
      ? ['Confirm the campaign queue migration is applied to the intended Neon branch.', 'Confirm Vercel Queues is enabled and the consumer route is part of the deployed build.', 'After you choose to deploy, verify SMTP and manually test only to an address you control.']
      : ['Start the sender on a persistent service connected to the same Neon database as the app.', 'Set the stable sender URL and matching ENGINE_API_TOKEN in the app and worker secret stores.', 'After the worker is ready, verify SMTP and manually test only to an address you control.']

  return (
    <>
      <div className="min-h-screen flex flex-col bg-muted/20">
        {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2.5">
              <img src="/logo.svg" alt="Mail Pulse" className="h-8 w-auto" />
              <h1 className="font-semibold text-base">Mail Pulse</h1>
              <WorkspaceSwitcher />
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="flex items-center gap-3 mr-1 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => {
                  setEngineDialogOpen(true)
                  void runBackendDiagnostics(false)
                }}
                aria-haspopup="dialog"
                aria-expanded={engineDialogOpen}
                aria-label={`Backend status: ${headerStatusLabel}. Open diagnostics.`}
                title={engineDiagnostics?.message || `App: ${health?.app || 'checking'} · Database: ${health?.db || 'checking'} · Campaign delivery: ${visibleEngineStatus || 'checking'}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-1.5 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${!health ? 'bg-muted-foreground' : headerStatusReady ? 'bg-emerald-500' : 'bg-amber-500'} ${headerStatusReady ? '' : 'mp-pulse'}`} />
                <span className="hidden sm:inline">{headerStatusLabel}</span>
                <span className="sm:hidden">Status</span>
              </button>
              <span className="hidden xl:inline-flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-amber-500" /> {activeCount} active</span>
              <span className="hidden xl:inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {totalSent.toLocaleString()} sent</span>
              <span className="hidden xl:inline-flex items-center gap-1"><BarChart3 className="h-3.5 w-3.5 text-brand" /> {sessions.length} campaigns</span>
            </div>
            <Sheet open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 px-2.5 lg:hidden" aria-label={`Open ${showTrash ? 'campaign trash' : 'recent campaigns'}, ${sessions.length} total`}>
                  <History className="h-4 w-4" />
                  <span className="hidden min-[400px]:inline">{showTrash ? 'Trash' : 'Recent'}</span>
                  <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1 text-[10px] tabular-nums">{sessions.length}</Badge>
                </Button>
              </SheetTrigger>
              <SheetContent side="top" className="top-14 h-[80dvh] max-h-[calc(100dvh-3.5rem)] gap-0 overflow-hidden rounded-b-2xl border-x-0 border-t-0 p-0 lg:hidden">
                <SheetHeader className="shrink-0 border-b px-4 py-3 pr-14">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <SheetTitle className="text-sm">Recent campaigns</SheetTitle>
                      <SheetDescription className="text-xs">Search your full history, open a campaign, or manage items in Trash.</SheetDescription>
                    </div>
                    <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">{filtered.length} shown</span>
                  </div>
                </SheetHeader>
                <div className="shrink-0 space-y-2 border-b p-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={showTrash ? 'Search trash…' : 'Search campaigns…'} className="h-9 pl-9 text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant={showTrash ? 'outline' : 'default'} size="sm" className="h-8 text-xs" aria-pressed={!showTrash} onClick={() => { if (showTrash) { setShowTrash(false); setLoadingList(true) } }}>
                      Active
                    </Button>
                    <Button type="button" variant={showTrash ? 'default' : 'outline'} size="sm" className="h-8 text-xs" aria-pressed={showTrash} onClick={() => { if (!showTrash) { setShowTrash(true); setLoadingList(true) } }}>
                      Trash
                    </Button>
                  </div>
                </div>
                <ScrollArea className="min-h-0 flex-1 p-3">
                  {loadingList ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">Loading campaigns…</div>
                  ) : filtered.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      <Mail className="mx-auto mb-2 h-8 w-8 opacity-30" />
                      {sessions.length === 0 ? (showTrash ? 'Trash is empty.' : 'No campaigns yet.') : 'No campaigns match your search.'}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filtered.map((s) => {
                        const meta = sessionStatusMeta[s.status]
                        const isActive = s.status === 'running' || s.status === 'paused' || s.status === 'queued'
                        return (
                          <div key={s.id} className={`rounded-xl border p-3 transition-colors ${selectedId === s.id ? 'border-brand/40 bg-blue-500/10' : 'border-border bg-background hover:bg-muted/40'}`}>
                            <div className="flex items-start gap-3">
                              <button type="button" onClick={() => { if (!showTrash) { setMobileHistoryOpen(false); openSession(s.id) } }} disabled={showTrash} aria-label={`Open campaign ${s.name}`} className="min-w-0 flex-1 text-left disabled:cursor-default">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color || '#3b82f6' }} />
                                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                                  <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot} ${isActive && s.status === 'running' ? 'mp-pulse' : ''}`} />
                                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${meta.color}`}>{meta.label}</span>
                                </div>
                                <p className="mt-1 truncate text-xs text-muted-foreground">{s.subject || '(no subject)'}</p>
                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                                  <span>{s.category || 'General'}</span>
                                  <span className="tabular-nums">{s.sentCount.toLocaleString()} / {s.totalEmails.toLocaleString()} sent</span>
                                  <span>{formatTime(s.createdAt)}</span>
                                </div>
                              </button>
                              {showTrash && (
                                <div className="flex shrink-0 flex-col gap-1">
                                  <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-[10px]" onClick={async () => { try { await api.restoreSession(s.id); await loadSessions(); toast.success('Restored') } catch { toast.error('Could not restore campaign') } }}>
                                    Restore
                                  </Button>
                                  <Button type="button" size="sm" variant="destructive" className="h-8 px-2 text-[10px]" onClick={async () => { if (confirm('Permanently delete this campaign?')) { try { await api.permanentDeleteSession(s.id); await loadSessions(); toast.success('Permanently deleted') } catch { toast.error('Could not delete campaign') } } }}>
                                    Delete
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </ScrollArea>
                <div className="flex shrink-0 items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                  <span>{showTrash ? 'Trash total sent' : 'Total sent'}</span>
                  <span className="tabular-nums">{totalSent.toLocaleString()} / {totalAll.toLocaleString()}</span>
                </div>
              </SheetContent>
            </Sheet>
            {mounted && (
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            )}
            <SignOutButton />
            <Button size="sm" className="bg-brand text-white hover:bg-blue-700 hidden sm:inline-flex" onClick={newCampaign}>
              <Plus className="h-4 w-4" /> New campaign
            </Button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar — fixed on scroll: stays visible while content moves */}
        <aside className="w-72 shrink-0 border-r bg-background hidden lg:flex flex-col sticky top-14 self-start max-h-[calc(100vh-3.5rem-2.5rem)] min-h-[calc(100vh-3.5rem-2.5rem)]">
          <div className="p-3 space-y-3">
            <Button className="w-full bg-brand text-white hover:bg-blue-700" onClick={newCampaign}>
              <Plus className="h-4 w-4" /> New campaign
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search campaigns…" className="h-8 pl-8 text-sm" />
            </div>
            <div className="flex gap-1">
              <Button variant={showTrash ? 'outline' : 'default'} size="sm" className="flex-1 h-7 text-xs" onClick={() => { setShowTrash(false); setLoadingList(true) }}>
                Active
              </Button>
              <Button variant={showTrash ? 'default' : 'outline'} size="sm" className="flex-1 h-7 text-xs" onClick={() => { setShowTrash(true); setLoadingList(true) }}>
                Trash
              </Button>
            </div>
          </div>
          <div className="px-3 pb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> {showTrash ? 'Trash' : 'Campaign history'}</span>
            <span className="text-[10px] text-muted-foreground">{filtered.length}</span>
          </div>
          <ScrollArea className="flex-1 px-2 pb-3">
            {loadingList ? (
              <div className="p-4 text-center text-xs text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
                {sessions.length === 0 ? 'No campaigns yet. Create your first one!' : 'No matches.'}
              </div>
            ) : (
              <div className="space-y-1">
                {filtered.map((s) => {
                  const meta = sessionStatusMeta[s.status]
                  const isActive = s.status === 'running' || s.status === 'paused' || s.status === 'queued'
                  return (
                    <div
                      key={s.id}
                      className={`w-full text-left p-2.5 rounded-lg transition-colors border ${
                        selectedId === s.id ? 'bg-blue-500/10 border-brand/40' : 'border-transparent hover:bg-muted/60'
                      }`}
                    >
                      <button
                        onClick={() => !showTrash && openSession(s.id)}
                        className="w-full text-left"
                      >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-medium truncate flex-1 flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || '#3b82f6' }} />
                          {s.name}
                        </span>
                        <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dot} ${isActive && s.status === 'running' ? 'mp-pulse' : ''}`} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate mb-1.5">{s.subject || '(no subject)'}</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color} border`}>{meta.label}</span>
                        {s.category && s.category !== 'General' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">{s.category}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {s.sentCount}/{s.totalEmails} sent
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">{formatTime(s.createdAt)}</p>
                    </button>
                    {showTrash && (
                      <div className="flex gap-1 mt-2 px-1">
                        <Button size="sm" variant="outline" className="h-6 text-[10px] flex-1" onClick={async (e) => { e.stopPropagation(); await api.restoreSession(s.id); loadSessions(); toast.success('Restored') }}>
                          Restore
                        </Button>
                        <Button size="sm" variant="destructive" className="h-6 text-[10px] flex-1" onClick={async (e) => { e.stopPropagation(); if (confirm('Permanently delete?')) { await api.permanentDeleteSession(s.id); loadSessions(); toast.success('Permanently deleted') } }}>
                          Delete forever
                        </Button>
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>
          <div className="p-3 border-t text-[10px] text-muted-foreground space-y-1">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Passwords encrypted on this device</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Total sent</span>
              <span className="tabular-nums">{totalSent.toLocaleString()} / {totalAll.toLocaleString()}</span>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="p-4 sm:p-6 pb-8 lg:pb-12">
            {view === 'wizard' ? (
              <Wizard key={wizardKey} onLaunched={onLaunched} onCancel={newCampaign} initialName={wizardInitialName} initialColor={wizardInitialColor} initialCategory={wizardInitialCategory} />
            ) : selectedId ? (
              <SessionView
                sessionId={selectedId}
                onBack={() => { setView('wizard'); setSelectedId(null) }}
                onDeleted={onDeleted}
                onSessionUpdated={loadSessions}
                onOpenSession={openSession}
              />
            ) : null}
          </div>
        </main>
      </div>

      {/* Footer (sticky) */}
      <footer className="mt-auto border-t bg-background">
        <div className="px-4 h-10 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Send className="h-3.5 w-3.5 text-brand" /> MailPulse — send up to 1,000 personalized emails per campaign
          </span>
          <span className="hidden sm:inline">Built with Next.js · nodemailer · socket.io</span>
        </div>
      </footer>

    </div>
    <Dialog open={campaignModalOpen} onOpenChange={setCampaignModalOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Campaign</DialogTitle>
          <DialogDescription>
            Name, categorize, and color-code your campaign before you start building it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="new-campaign-name">Campaign name</Label>
            <Input
              id="new-campaign-name"
              value={newCampaignName}
              onChange={(e) => setNewCampaignName(e.target.value)}
              placeholder="e.g. November Newsletter"
              className="mt-1"
              autoFocus
            />
          </div>
          <div>
            <Label>Campaign category</Label>
            <select
              value={newCampaignCategory}
              onChange={(e) => setNewCampaignCategory(e.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="General">General</option>
              <option value="Newsletter">Newsletter</option>
              <option value="Promotion">Promotion</option>
              <option value="Announcement">Announcement</option>
              <option value="Follow-up">Follow-up</option>
              <option value="Event">Event</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <Label className="mt-2 block">Campaign color</Label>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {['#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#6366f1'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewCampaignColor(c)}
                  className={`h-7 w-7 rounded-full border-2 transition-all ${newCampaignColor === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
              <div className="relative h-8 w-8 rounded-full overflow-hidden border border-border cursor-pointer" style={{ background: 'linear-gradient(135deg, #7c3aed, #ec4899)', filter: 'blur(1px)' }}>
                <ColorPicker className="absolute inset-0 m-auto h-4 w-4 text-white pointer-events-none z-10" />
                <input
                  type="color"
                  value={newCampaignColor}
                  onChange={(e) => setNewCampaignColor(e.target.value)}
                  className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                  title="Custom color"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">Pick a color to identify this campaign.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCampaignModalOpen(false)}>Cancel</Button>
          <Button className="bg-brand text-white hover:bg-blue-700" onClick={createCampaign}>
            Create & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog
      open={engineDialogOpen}
      onOpenChange={setEngineDialogOpen}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-left">
          <div className="flex items-start gap-3 pr-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <Server className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle>Backend diagnostics</DialogTitle>
              <DialogDescription className="mt-1">
                Check the app, Neon, and campaign delivery path, then get a safe repair brief.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {diagnosticRows.map((row) => (
            <div key={row.label} className="rounded-xl border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{row.label}</span>
                <Badge variant="outline" className={`shrink-0 ${healthStatusClass(row.status)}`}>
                  {displayHealthStatus(row.status)}
                </Badge>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{row.detail}</p>
            </div>
          ))}
        </div>

        {engineDiagnostics?.worker && (
          <div className="rounded-xl border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Server className="h-4 w-4 text-brand" /> Worker readiness report
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border bg-background px-2 py-1">Database: {engineDiagnostics.worker.database || 'not reported'}</span>
              <span className="rounded-md border bg-background px-2 py-1">Recovery: {engineDiagnostics.worker.recovery || 'not reported'}</span>
              <span className="rounded-md border bg-background px-2 py-1">Lease: {engineDiagnostics.worker.lease || 'not reported'}</span>
              <span className="rounded-md border bg-background px-2 py-1">Control auth: {engineDiagnostics.worker.controlAuth || 'not reported'}</span>
            </div>
          </div>
        )}

        <section className="space-y-3 rounded-xl border border-brand/20 bg-brand/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-brand" /> Guided repair plan
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {engineDiagnostics?.message || (queueMode ? 'Run diagnostics to check the Vercel Queue path and Neon schema.' : 'Run diagnostics to identify whether the sender URL, worker process, Neon connection, or control token needs attention.')}
          </p>
          <ol className="space-y-2 pl-5 text-sm leading-relaxed text-foreground marker:text-brand">
            {repairSteps.map((step, index) => <li key={`${index}-${step}`} className="list-decimal">{step}</li>)}
          </ol>
          <p className="text-xs leading-relaxed text-muted-foreground">
            This check does not test SMTP credentials, enqueue a campaign, or send email. It cannot start a remote worker or change Vercel project settings or secrets.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Copy the redacted brief into your AI coding assistant to review the backend fix. It contains no URLs, tokens, SMTP passwords, or recipient addresses.
          </p>
        </section>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            Checked {engineDiagnostics?.checkedAt || health?.checkedAt ? new Date(engineDiagnostics?.checkedAt || health?.checkedAt || '').toLocaleTimeString() : 'not yet'}
          </span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={copyAiRepairBrief} disabled={!health && !engineDiagnostics}>
              <Copy className="h-4 w-4" /> Copy AI brief
            </Button>
            <Button type="button" onClick={() => runBackendDiagnostics(true)} disabled={checkingDiagnostics}>
              <RefreshCw className={`h-4 w-4 ${checkingDiagnostics ? 'animate-spin' : ''}`} />
              {checkingDiagnostics ? 'Checking…' : 'Run checks again'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
)
}
