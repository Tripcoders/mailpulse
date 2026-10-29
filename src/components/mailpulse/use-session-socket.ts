'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import type { LogEntry, ProgressPayload } from '@/lib/types'

interface UseSessionSocketOptions {
  sessionId: string | null
  onProgress?: (p: ProgressPayload) => void
  onCompleted?: (payload: { sessionId: string; sent: number; failed: number; total: number }) => void
  onCancelled?: (payload: { sessionId: string }) => void
}

/**
 * Live log/progress socket with a candidate chain, so it works unchanged on
 * localhost dev, in Docker behind the gateway, and through HTTPS tunnels:
 *   1. same-origin `/engine/socket`  → gateway reverse-proxy → engine:3003
 *   2. sandbox transform path        → the dev-runtime port proxy
 * Each candidate gets a connect attempt; the first one that works is locked
 * in for reconnects. If none connect, `connected` stays false and the session
 * view's HTTP poll fallback keeps monitoring going.
 */

// How the browser reaches the send engine (order = preference). The first
// uses the reverse-proxied same-origin route (any host, Docker, tunnels).
// The second is the dev-runtime transform endpoint.
// The third is a direct connection to an external engine (production).
const EXTERNAL_ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || ''
const CONNECT_URLS: { path?: string; rawUrl?: string; direct?: boolean }[] = [
  ...(EXTERNAL_ENGINE_URL ? [{ rawUrl: EXTERNAL_ENGINE_URL, direct: true }] : []),
  { path: '/engine/socket' },
  { rawUrl: '/?XTransformPort=3003' },
]

export function useSessionSocket({ sessionId, onProgress, onCompleted, onCancelled }: UseSessionSocketOptions) {
  const [connected, setConnected] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const socketRef = useRef<Socket | null>(null)
  const callbacksRef = useRef({ onProgress, onCompleted, onCancelled })

  // Keep latest callbacks in a ref without mutating during render
  useEffect(() => {
    callbacksRef.current = { onProgress, onCompleted, onCancelled }
  }, [onProgress, onCompleted, onCancelled])

  const appendLog = useCallback((entry: LogEntry) => {
    setLogs((prev) => {
      const next = [...prev, entry]
      if (next.length > 1000) return next.slice(next.length - 1000)
      return next
    })
  }, [])

  const clearLogs = useCallback(() => setLogs([]), [])

  // Reset logs when sessionId changes (React-recommended "adjust state during render" pattern)
  const [prevSessionId, setPrevSessionId] = useState<string | null>(sessionId)
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId)
    setLogs([])
  }

  useEffect(() => {
    if (!sessionId) return

    let disposed = false
    let attemptTimer: any = null
    let lockIndex: number | null = null
    let current: Socket | null = null

    const clear = () => {
      if (attemptTimer) { clearTimeout(attemptTimer); attemptTimer = null }
      if (current) { current.disconnect(); current = null; socketRef.current = null }
    }

    const attempt = (index: number) => {
      if (disposed || !sessionId) return
      const c = CONNECT_URLS[index]
      const baseOpts = { transports: ['websocket'] as ['websocket'], reconnection: false, timeout: 6000, forceNew: true }
      let s: Socket
      if (c.direct) {
        // Direct connection to external engine — use its full URL with default socket.io path
        s = io(c.rawUrl!, baseOpts)
      } else if (c.rawUrl) {
        s = io(c.rawUrl, baseOpts)
      } else {
        s = io(c.path || '/engine/socket', baseOpts)
      }
      current = s
      socketRef.current = s
      let hadConnected = false

      const failTimer = setTimeout(() => {
        if (hadConnected || disposed) return
        s.disconnect()
        nextCandidate(index)
      }, 7000)

      s.on('connect', () => {
        hadConnected = true
        clearTimeout(failTimer)
        lockIndex = index
        setConnected(true)
        s.emit('subscribe', sessionId)
      })
      s.on('connect_error', () => {
        clearTimeout(failTimer)
        setConnected(false)
        if (!hadConnected) {
          s.disconnect()
          nextCandidate(index)
        }
      })
      s.on('disconnect', () => {
        setConnected(false)
        // Reconnect on the endpoint that worked before (any transport hiccup)
        if (!disposed && sessionId) {
          attemptTimer = setTimeout(() => attempt(lockIndex ?? index), 1500)
        }
      })

      s.on('history', (history: LogEntry[]) => setLogs(history))
      s.on('log', (entry: LogEntry) => appendLog(entry))
      s.on('progress', (p: ProgressPayload) => callbacksRef.current.onProgress?.(p))
      s.on('completed', (payload: any) => callbacksRef.current.onCompleted?.(payload))
      s.on('cancelled', (payload: any) => callbacksRef.current.onCancelled?.(payload))
    }

    const nextCandidate = (fromIndex: number) => {
      if (disposed) return
      const next = fromIndex + 1
      if (next < CONNECT_URLS.length) {
        attemptTimer = setTimeout(() => attempt(next), 400)
      } else {
        // All endpoints failed — wait and start over (engine may be restarting)
        lockIndex = null
        attemptTimer = setTimeout(() => attempt(0), 3000)
      }
    }

    attempt(lockIndex ?? 0)

    return () => {
      disposed = true
      clear()
      setConnected(false)
    }
  }, [sessionId, appendLog])

  return { connected, logs, clearLogs }
}
