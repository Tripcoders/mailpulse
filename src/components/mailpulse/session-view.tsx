'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  ArrowLeft, Pause, Play, XCircle, RefreshCw, Trash2, Mail, Paperclip,
  CheckCircle2, FailIcon, Clock, Send, Settings2, User, Calendar,
  Server, Loader2, ExternalLink, Copy, RotateCcw,
} from './icons'
import { api } from '@/lib/api'
import { useSessionSocket } from './use-session-socket'
import { LiveLogs } from './live-logs'
import { RecipientsTable } from './recipients-table'
import { sessionStatusMeta, formatTime, formatBytes, duration } from './helpers'
import type { SessionDetail, ProgressPayload, Attachment, LogEntry } from '@/lib/types'

interface SessionViewProps {
  sessionId: string
  onBack: () => void
  onDeleted: () => void
  onSessionUpdated: () => void
  onOpenSession: (id: string) => void
}

export function SessionView({ sessionId, onBack, onDeleted, onSessionUpdated, onOpenSession }: SessionViewProps) {
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [progress, setProgress] = useState<ProgressPayload | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [restartOpen, setRestartOpen] = useState(false)
  const [restartUser, setRestartUser] = useState('')
  const [restartPass, setRestartPass] = useState('')
  const [restarting, setRestarting] = useState(false)

  const loadSession = useCallback(async () => {
    try {
      const data = await api.getSession(sessionId)
      setSession(data.session as SessionDetail)
      setAttachments(data.session.attachments || [])
      setProgress({
        id: data.session.id,
        status: data.session.status,
        totalEmails: data.session.totalEmails,
        sentCount: data.session.sentCount,
        failedCount: data.session.failedCount,
        pendingCount: data.session.pendingCount,
        startedAt: data.session.startedAt,
        completedAt: data.session.completedAt,
      })
    } catch (e: any) {
      toast.error(e.message || 'Failed to load session')
    }
  }, [sessionId])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  // Poll session while running
  useEffect(() => {
    const status = progress?.status
    if (status !== 'running' && status !== 'paused' && status !== 'queued') return
    const interval = setInterval(() => {
      loadSession()
      setRefreshKey((k) => k + 1)
    }, 2500)
    return () => clearInterval(interval)
  }, [progress?.status, loadSession])

  const { connected, logs, clearLogs } = useSessionSocket({
    sessionId,
    onProgress: (p) => {
      setProgress(p)
      onSessionUpdated()
    },
    onCompleted: (payload) => {
      if ((payload as any).error) {
        toast.error(`Campaign failed — SMTP verification failed. 0 of ${payload.total} sent. Check the logs and restart with valid credentials.`, { duration: 9000 })
      } else {
        toast.success(`Campaign complete! ${payload.sent} sent, ${payload.failed} failed.`, { duration: 8000 })
      }
      loadSession()
      setRefreshKey((k) => k + 1)
      onSessionUpdated()
    },
    onCancelled: () => {
      toast.info('Campaign cancelled')
      loadSession()
      onSessionUpdated()
    },
  })

  // Backup channel: when the live socket feed can't connect (engine down,
  // proxies, VPNs), poll the HTTP logs endpoint so monitoring never goes blind.
  const [pollLogs, setPollLogs] = useState<LogEntry[]>([])
  useEffect(() => {
    if (connected) { setPollLogs([]); return }
    let alive = true
    const tick = async () => {
      try {
        const d = await api.get<{ logs: any[] }>(`/api/sessions/${sessionId}/logs?limit=300`)
        if (alive) {
          setPollLogs((d.logs || []).map((l: any) => ({
            level: l.level, message: l.message, recipient: l.recipient, timestamp: typeof l.createdAt === 'string' ? l.createdAt : new Date(l.createdAt).toISOString(),
          })))
        }
      } catch { /* engine fully down — retry next tick */ }
    }
    tick()
    const i = setInterval(tick, 2500)
    return () => { alive = false; clearInterval(i) }
  }, [connected, sessionId])
  const liveLogs = connected ? logs : (pollLogs.length >= logs.length ? pollLogs : logs)

  const act = async (fn: () => Promise<any>, label: string) => {
    setActing(label)
    try {
      await fn()
      toast.success(`${label} requested`)
      setTimeout(loadSession, 500)
    } catch (e: any) {
      toast.error(e.message || `${label} failed`)
    } finally {
      setActing(null)
    }
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const status = progress?.status || session.status
  const meta = sessionStatusMeta[status]
  const total = progress?.totalEmails ?? session.totalEmails
  const sent = progress?.sentCount ?? session.sentCount
  const failed = progress?.failedCount ?? session.failedCount
  const pending = progress?.pendingCount ?? session.pendingCount
  const pct = total > 0 ? Math.round(((sent + failed) / total) * 100) : 0
  const isRunning = status === 'running'
  const isPaused = status === 'paused'
  const isActive = isRunning || isPaused || status === 'queued'
  const hasFailed = failed > 0
  // Can restart a non-active session if there are pending recipients (e.g. SMTP verify failed, or cancelled mid-run)
  const canRestart = !isActive && pending > 0 && (status === 'failed' || status === 'cancelled' || status === 'draft')

  const doRestart = async () => {
    if (!restartUser.trim() || !restartPass.trim()) {
      toast.error('Enter your email and app password')
      return
    }
    setRestarting(true)
    try {
      await api.startSession(sessionId, restartUser.trim(), restartPass.trim())
      toast.success('Restarting send engine with new credentials…')
      setRestartOpen(false)
      setRestartPass('')
      setTimeout(loadSession, 500)
      onSessionUpdated()
    } catch (e: any) {
      toast.error(e.message || 'Failed to restart')
    } finally {
      setRestarting(false)
    }
  }

  const doDuplicate = async () => {
    setActing('Duplicate')
    try {
      const { session: copy } = await api.duplicateSession(sessionId)
      toast.success(`Duplicated as "${copy.name}"`)
      onSessionUpdated()
      onOpenSession(copy.id)
    } catch (e: any) {
      toast.error(e.message || 'Failed to duplicate campaign')
    } finally {
      setActing(null)
    }
  }

  const doReset = async () => {
    if (!confirm('Reset this campaign to draft? All recipients will be re-queued and logs cleared. This cannot be undone.')) return
    setActing('Reset')
    try {
      await api.resetSession(sessionId)
      toast.success('Campaign reset to draft — ready for a fresh run')
      loadSession()
      onSessionUpdated()
    } catch (e: any) {
      toast.error(e.message || 'Failed to reset campaign')
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="sm" className="mt-1" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: session.color || '#3b82f6' }} />
              <h1 className="text-xl font-semibold truncate">{session.name}</h1>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${meta.color}`}>
                {(isRunning || isPaused) && <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${isRunning ? 'mp-pulse' : ''}`} />}
                {meta.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> Created {formatTime(session.createdAt)}</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Duration {duration(session.startedAt, session.completedAt)}</span>
              <span className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-rose-400'}`} />
                {connected ? 'Live stream connected' : 'Reconnecting…'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {isRunning && (
            <Button variant="outline" size="sm" onClick={() => act(api.pauseSession.bind(null, sessionId), 'Pause')} disabled={!!acting}>
              {acting === 'Pause' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />} Pause
            </Button>
          )}
          {isPaused && (
            <Button variant="outline" size="sm" onClick={() => act(api.resumeSession.bind(null, sessionId), 'Resume')} disabled={!!acting}>
              {acting === 'Resume' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Resume
            </Button>
          )}
          {isActive && (
            <Button variant="outline" size="sm" className="text-rose-600 hover:text-rose-700" onClick={() => act(api.cancelSession.bind(null, sessionId), 'Cancel')} disabled={!!acting}>
              {acting === 'Cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Cancel
            </Button>
          )}
          {hasFailed && !isActive && (
            <Button size="sm" className="bg-brand text-white hover:bg-blue-700" onClick={() => act(api.resendSession.bind(null, sessionId), 'Resend failed')} disabled={!!acting}>
              {acting === 'Resend failed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Resend failed ({failed})
            </Button>
          )}
          {canRestart && (
            <Button size="sm" className="bg-brand text-white hover:bg-blue-700" onClick={() => setRestartOpen(true)}>
              <RefreshCw className="h-4 w-4" /> Restart with credentials
            </Button>
          )}
          {!isActive && (
            <Button variant="outline" size="sm" onClick={doReset} disabled={!!acting} title="Reset to draft — re-queue all recipients for a fresh run">
              {acting === 'Reset' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reset
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={doDuplicate} disabled={!!acting} title="Duplicate — reuse this campaign as a new draft">
            {acting === 'Duplicate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} Duplicate
          </Button>
          <Button variant="outline" size="sm" className="text-rose-600 hover:text-rose-700" onClick={async () => {
            if (!confirm('Delete this campaign and all its data? This cannot be undone.')) return
            await api.deleteSession(sessionId)
            toast.success('Campaign deleted')
            onDeleted()
          }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats + progress */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Send} label="Total" value={total} tone="slate" />
        <StatCard icon={CheckCircle2} label="Sent" value={sent} tone="emerald" />
        <StatCard icon={FailIcon} label="Failed" value={failed} tone="rose" />
        <StatCard icon={Clock} label="Pending" value={pending} tone="amber" />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Send progress</span>
            <span className="text-sm font-mono text-muted-foreground">{sent + failed} / {total} · {pct}%</span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden relative">
            <div
              className={`h-full ${isRunning ? 'bg-emerald-500' : isPaused ? 'bg-amber-500' : status === 'completed' ? 'bg-emerald-600' : status === 'failed' ? 'bg-rose-500' : 'bg-slate-400'} ${isRunning ? 'mp-stripes' : ''} transition-all duration-300`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>Success rate: {sent + failed > 0 ? Math.round((sent / (sent + failed)) * 100) : 0}%</span>
            <span>·</span>
            <span>Started {formatTime(session.startedAt)}</span>
            {session.completedAt && <><span>·</span><span>Finished {formatTime(session.completedAt)}</span></>}
          </div>
        </CardContent>
      </Card>

      {/* Live logs + details */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <LiveLogs logs={liveLogs} connected={connected} live={isActive} onClear={clearLogs} />
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3 px-4"><CardTitle className="text-sm font-medium">Session details</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0 space-y-2.5 text-sm">
              <DetailRow icon={User} label="Sender" value={`${session.fromName} <${session.fromEmail}>`} />
              <DetailRow icon={Server} label="Provider" value={session.providerType.toUpperCase()} />
              {session.smtpHost && <DetailRow icon={Server} label="SMTP" value={`${session.smtpHost}:${session.smtpPort}`} />}
              <DetailRow icon={Settings2} label="Throttle" value={`${session.batchSize}/batch · ${session.batchDelayMs}ms · ${session.perEmailDelayMs}ms/email`} />
              <DetailRow icon={Paperclip} label="Attachments" value={`${attachments.length} file(s)`} />
            </CardContent>
          </Card>
          {attachments.length > 0 && (
            <Card>
              <CardHeader className="py-3 px-4"><CardTitle className="text-sm font-medium">Attachments</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                {attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-sm">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{a.filename}</span>
                    <span className="text-xs text-muted-foreground">{formatBytes(a.size)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Email preview */}
      <Card>
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Mail className="h-4 w-4 text-brand" /> Email message</CardTitle>
          <Badge variant="secondary" className="font-normal text-xs">Subject: {session.subject}</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="p-4 text-sm max-h-80 overflow-y-auto scroll-thin" dangerouslySetInnerHTML={{ __html: session.bodyHtml }} />
          {(session.signatureText || session.signatureImage) && (
            <>
              <Separator />
              <div className="p-4 bg-muted/30">
                <p className="text-xs text-muted-foreground mb-2">Signature</p>
                {session.signatureText && <div className="text-sm whitespace-pre-wrap text-slate-600">{session.signatureText}</div>}
                {session.signatureImage && <img src={session.signatureImage} alt="signature" className="max-h-20 mt-2" />}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Recipients table */}
      <RecipientsTable sessionId={sessionId} refreshKey={refreshKey} />

      <p className="text-xs text-center text-muted-foreground pt-2">
        Tip: while a campaign is running, this page auto-refreshes every few seconds. <ExternalLink className="inline h-3 w-3" /> You can safely leave this tab — logs are persisted.
      </p>

      {/* Restart dialog */}
      <Dialog open={restartOpen} onOpenChange={setRestartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart campaign</DialogTitle>
            <DialogDescription>
              This campaign has {pending} pending recipient{pending === 1 ? '' : 's'}. Re-enter your SMTP credentials to retry sending. Only pending recipients will be processed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="restart-user">Email / SMTP username</Label>
              <Input id="restart-user" value={restartUser} onChange={(e) => setRestartUser(e.target.value)} placeholder="you@gmail.com" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="restart-pass">App password</Label>
              <Input id="restart-pass" type="password" value={restartPass} onChange={(e) => setRestartPass(e.target.value)} placeholder="Paste your app password" className="mt-1" />
            </div>
            <p className="text-xs text-muted-foreground">Provider: <span className="font-medium">{session.providerType.toUpperCase()}</span>{session.smtpHost ? ` · ${session.smtpHost}:${session.smtpPort}` : ''}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestartOpen(false)} disabled={restarting}>Cancel</Button>
            <Button onClick={doRestart} disabled={restarting} className="bg-brand text-white hover:bg-blue-700">
              {restarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {restarting ? 'Starting…' : 'Start sending'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: 'slate' | 'emerald' | 'rose' | 'amber' }) {
  const tones = {
    slate: 'text-slate-700 bg-slate-50',
    emerald: 'text-emerald-700 bg-emerald-50',
    rose: 'text-rose-700 bg-rose-50',
    amber: 'text-amber-700 bg-amber-50',
  }
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="text-xs text-muted-foreground">{label}: </span>
        <span className="text-sm break-words">{value}</span>
      </div>
    </div>
  )
}
