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

    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      timeout: 10000,
      forceNew: true,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('subscribe', sessionId)
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', () => setConnected(false))

    socket.on('history', (history: LogEntry[]) => {
      setLogs(history)
    })
    socket.on('log', (entry: LogEntry) => {
      appendLog(entry)
    })
    socket.on('progress', (p: ProgressPayload) => {
      callbacksRef.current.onProgress?.(p)
    })
    socket.on('completed', (payload: any) => {
      callbacksRef.current.onCompleted?.(payload)
    })
    socket.on('cancelled', (payload: any) => {
      callbacksRef.current.onCancelled?.(payload)
    })

    return () => {
      socket.emit('unsubscribe', sessionId)
      socket.disconnect()
      socketRef.current = null
      setConnected(false)
    }
  }, [sessionId, appendLog])

  return { connected, logs, clearLogs }
}
