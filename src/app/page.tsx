'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  Plus, Mail, Clock, CheckCircle2, AlertCircle, History,
  Sun, Moon, Search, Zap, ShieldCheck, BarChart3, Send,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { api } from '@/lib/api'
import { Wizard } from '@/components/mailpulse/wizard'
import { SessionView } from '@/components/mailpulse/session-view'
import { sessionStatusMeta, formatTime } from '@/components/mailpulse/helpers'
import type { SessionSummary } from '@/lib/types'

export default function Home() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [view, setView] = useState<'wizard' | 'session'>('wizard')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => { setMounted(true) }, [])

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.listSessions()
      setSessions(data.sessions as SessionSummary[])
    } catch {
      // ignore
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    loadSessions()
    // refresh history periodically
    const i = setInterval(loadSessions, 8000)
    return () => clearInterval(i)
  }, [loadSessions])

  const newCampaign = () => {
    setSelectedId(null)
    setView('wizard')
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

  return (
    <div className="min-h-screen flex flex-col bg-muted/20">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center">
              <Mail className="h-4.5 w-4.5 text-white" />
            </div>
            <div className="leading-tight">
              <h1 className="font-semibold text-base flex items-center gap-1.5">MailPulse <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">v1.0</span></h1>
              <p className="text-[11px] text-muted-foreground hidden sm:block">Bulk email sender · CSV → personalized → SMTP</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-3 mr-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-amber-500" /> {activeCount} active</span>
              <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {totalSent.toLocaleString()} sent</span>
              <span className="inline-flex items-center gap-1"><BarChart3 className="h-3.5 w-3.5 text-brand" /> {sessions.length} campaigns</span>
            </div>
            {mounted && (
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            )}
            <Button size="sm" className="bg-brand text-white hover:bg-emerald-700 hidden sm:inline-flex" onClick={newCampaign}>
              <Plus className="h-4 w-4" /> New campaign
            </Button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-72 shrink-0 border-r bg-background hidden lg:flex flex-col">
          <div className="p-3 space-y-3">
            <Button className="w-full bg-brand text-white hover:bg-emerald-700" onClick={newCampaign}>
              <Plus className="h-4 w-4" /> New campaign
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search campaigns…" className="h-8 pl-8 text-sm" />
            </div>
          </div>
          <div className="px-3 pb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> Campaign history</span>
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
                    <button
                      key={s.id}
                      onClick={() => openSession(s.id)}
                      className={`w-full text-left p-2.5 rounded-lg transition-colors border ${
                        selectedId === s.id ? 'bg-emerald-50/60 border-brand/40' : 'border-transparent hover:bg-muted/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-medium truncate flex-1">{s.name}</span>
                        <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dot} ${isActive && s.status === 'running' ? 'mp-pulse' : ''}`} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate mb-1.5">{s.subject || '(no subject)'}</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color} border`}>{meta.label}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {s.sentCount}/{s.totalEmails} sent
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">{formatTime(s.createdAt)}</p>
                    </button>
                  )
                })}
              </div>
            )}
          </ScrollArea>
          <div className="p-3 border-t text-[10px] text-muted-foreground space-y-1">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Credentials in-memory only</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Total sent</span>
              <span className="tabular-nums">{totalSent.toLocaleString()} / {totalAll.toLocaleString()}</span>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="p-4 sm:p-6 pb-36 lg:pb-12">
            {view === 'wizard' ? (
              <Wizard onLaunched={onLaunched} onCancel={() => {}} />
            ) : selectedId ? (
              <SessionView
                sessionId={selectedId}
                onBack={() => { setView('wizard'); setSelectedId(null) }}
                onDeleted={onDeleted}
                onSessionUpdated={loadSessions}
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

      {/* Mobile history bar */}
      {sessions.length > 0 && view === 'wizard' && (
        <div className="lg:hidden fixed bottom-12 left-0 right-0 border-t bg-background/95 backdrop-blur p-2 max-h-48 overflow-y-auto scroll-thin">
          <p className="text-[10px] font-medium text-muted-foreground px-1 pb-1">Recent campaigns</p>
          <div className="flex gap-2 overflow-x-auto scroll-thin pb-1">
            {sessions.slice(0, 8).map((s) => {
              const meta = sessionStatusMeta[s.status]
              return (
                <button key={s.id} onClick={() => openSession(s.id)} className="shrink-0 w-44 text-left p-2 rounded-lg border bg-background">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="text-xs font-medium truncate">{s.name}</span>
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${meta.dot}`} />
                  </div>
                  <span className={`text-[9px] px-1 py-0.5 rounded ${meta.color} border`}>{meta.label}</span>
                  <span className="text-[9px] text-muted-foreground ml-1">{s.sentCount}/{s.totalEmails}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
