'use client'

import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Radio, Pause, Download, Eraser } from 'lucide-react'
import { logLevelMeta, formatClock } from './helpers'
import type { LogEntry } from '@/lib/types'

interface LiveLogsProps {
  logs: LogEntry[]
  connected: boolean
  live: boolean
  onClear: () => void
}

export function LiveLogs({ logs, connected, live, onClear }: LiveLogsProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  const downloadLogs = () => {
    const text = logs
      .map((l) => `[${formatClock(l.timestamp)}] ${l.level.toUpperCase().padEnd(7)} ${l.recipient ? `(${l.recipient}) ` : ''}${l.message}`)
      .join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mailpulse-logs-${Date.now()}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="flex flex-col h-full bg-slate-950 border-slate-800">
      <CardHeader className="py-3 px-4 border-b border-slate-800 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-slate-200 flex items-center gap-2">
          <Radio className="h-4 w-4 text-emerald-400" />
          Live Logs
          {live && (
            <span className="inline-flex items-center gap-1.5 text-xs font-normal text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 mp-pulse" />
              LIVE
            </span>
          )}
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            onClick={onClear}
          >
            <Eraser className="h-3.5 w-3.5" /> Clear
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            onClick={downloadLogs}
            disabled={logs.length === 0}
          >
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full max-h-[60vh] lg:max-h-none overflow-y-auto scroll-thin font-mono text-xs leading-relaxed"
        >
          {logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2 p-8">
              <Pause className="h-6 w-6" />
              <span>Waiting for activity…</span>
              {!connected && <span className="text-rose-500 text-[10px]">Reconnecting to log stream…</span>}
            </div>
          ) : (
            <div className="p-2">
              {logs.map((l, i) => {
                const meta = logLevelMeta[l.level]
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 px-2 py-1 rounded hover:bg-slate-900/70"
                  >
                    <span className="text-slate-600 shrink-0 select-none">{formatClock(l.timestamp)}</span>
                    <span className={`shrink-0 w-4 text-center font-bold ${meta.color}`}>{meta.icon}</span>
                    <span className="text-slate-600 shrink-0 select-none w-12">{meta.label}</span>
                    <span className="text-slate-200 break-all">
                      {l.message}
                      {l.recipient && (
                        <span className="text-slate-500"> · {l.recipient}</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {!autoScroll && (
          <div className="absolute bottom-16 right-6">
            <Button
              size="sm"
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                setAutoScroll(true)
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
              }}
            >
              ↓ Jump to latest
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
