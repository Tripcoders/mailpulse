'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Users, Search, ChevronLeft, ChevronRight, Mail, MailCheck, MailX, Clock } from 'lucide-react'
import { api } from '@/lib/api'
import { recipientStatusMeta, formatTime } from './helpers'
import type { RecipientRecord, RecipientStatus } from '@/lib/types'

interface RecipientsTableProps {
  sessionId: string
  refreshKey: number
}

const FILTERS: { value: RecipientStatus | 'all'; label: string; icon: any }[] = [
  { value: 'all', label: 'All', icon: Users },
  { value: 'sent', label: 'Sent', icon: MailCheck },
  { value: 'failed', label: 'Failed', icon: MailX },
  { value: 'pending', label: 'Pending', icon: Clock },
  { value: 'sending', label: 'Sending', icon: Mail },
]

export function RecipientsTable({ sessionId, refreshKey }: RecipientsTableProps) {
  const [recipients, setRecipients] = useState<RecipientRecord[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<RecipientStatus | 'all'>('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const pageSize = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getRecipients(sessionId, { status, q, page, pageSize })
      setRecipients(data.recipients as RecipientRecord[])
      setTotal(data.total)
    } catch (e) {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [sessionId, status, q, page])

  useEffect(() => {
    setPage(1)
  }, [status, q])

  useEffect(() => {
    const t = setTimeout(() => load(), 250)
    return () => clearTimeout(t)
  }, [load, refreshKey])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Card>
      <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0 flex-wrap gap-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4 text-brand" />
          Recipients
          <Badge variant="secondary" className="font-mono">{total}</Badge>
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
            {FILTERS.map((f) => {
              const Icon = f.icon
              return (
                <button
                  key={f.value}
                  onClick={() => setStatus(f.value)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                    status === f.value ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {f.label}
                </button>
              )
            })}
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search email or name…"
              className="h-8 w-48 pl-7 text-xs"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[28rem] overflow-y-auto scroll-thin">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="font-medium px-4 py-2">Recipient</th>
                <th className="font-medium px-4 py-2">Status</th>
                <th className="font-medium px-4 py-2">Attempts</th>
                <th className="font-medium px-4 py-2">Sent at</th>
                <th className="font-medium px-4 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {loading && recipients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground text-xs">Loading…</td>
                </tr>
              ) : recipients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground text-xs">No recipients match this filter.</td>
                </tr>
              ) : (
                recipients.map((r) => {
                  const meta = recipientStatusMeta[r.status]
                  return (
                    <tr key={r.id} className="border-t hover:bg-muted/40">
                      <td className="px-4 py-2">
                        <div className="font-medium text-sm">{r.name || <span className="text-muted-foreground italic">No name</span>}</div>
                        <div className="text-xs text-muted-foreground">{r.email}</div>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>{meta.label}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{r.attemptCount}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{formatTime(r.sentAt)}</td>
                      <td className="px-4 py-2 text-xs text-rose-600 max-w-xs truncate" title={r.error || ''}>
                        {r.error || <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {total > pageSize && (
          <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground">
            <span>Page {page} of {totalPages}</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
