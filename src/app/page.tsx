'use client'

import { useEffect, useState, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  Plus, Mail, Clock, CheckCircle2, AlertCircle, History,
  Sun, Moon, Search, Zap, ShieldCheck, BarChart3, Send,
} from '@/components/mailpulse/icons'
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
  const [filter, setFilter] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const [health, setHealth] = useState<{ db: 'ok' | 'down'; engine: 'ok' | 'down' } | null>(null)

  useEffect(() => { setMounted(true) }, [])

  // Stack health indicator — surfaces degraded services before the user hits them
  useEffect(() => {
    let alive = true
    const tick = () => fetch('/api/health').then((r) => r.json()).then((h) => { if (alive) setHealth(h) }).catch(() => {})
    tick()
    const i = setInterval(tick, 12000)
    return () => { alive = false; clearInterval(i) }
  }, [selectedId])

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

  return (
    <>
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
              <span
                title={health ? `App: ok · Database: ${health.db} · Send engine: ${health.engine}` : 'Checking services…'}
                className="inline-flex items-center gap-1 cursor-help"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${!health ? 'bg-slate-300' : health.db === 'ok' && health.engine === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'} ${health?.engine === 'ok' && health?.db === 'ok' ? '' : 'mp-pulse'}`} />
                {health?.db !== 'ok' ? 'DB down' : health?.engine !== 'ok' ? 'Engine down' : 'All systems go'}
              </span>
              <span className="inline-flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-amber-500" /> {activeCount} active</span>
              <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {totalSent.toLocaleString()} sent</span>
              <span className="inline-flex items-center gap-1"><BarChart3 className="h-3.5 w-3.5 text-brand" /> {sessions.length} campaigns</span>
            </div>
            {mounted && (
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            )}
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
                        selectedId === s.id ? 'bg-emerald-50/60 border-brand/40' : 'border-transparent hover:bg-muted/60'
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
          <div className="p-4 sm:p-6 pb-36 lg:pb-12">
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
            <Label>Campaign color</Label>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
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
              <div className="relative h-7 w-7 rounded-full overflow-hidden border border-border cursor-pointer" style={{ background: 'conic-gradient(#ef4444, #f59e0b, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)' }}>
                <input
                  type="color"
                  value={newCampaignColor}
                  onChange={(e) => setNewCampaignColor(e.target.value)}
                  className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                  title="Custom color"
                />
              </div>
            </div>
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
  </>
)
}
