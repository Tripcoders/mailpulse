'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createAuthClient } from '@neondatabase/auth/next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const auth = createAuthClient()

export default function AuthCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('Authenticating...')

  useEffect(() => {
    async function handleCallback() {
      try {
        const session = await auth.getSession()
        const user = (session?.data as { user?: { id?: string; email?: string } | null })?.user
        if (user?.id) {
          setStatus('success')
          setMessage('Signed in successfully! Redirecting...')
          toast.success('Successfully signed in! Welcome to MailPulse.')
          setTimeout(() => {
            router.replace('/')
            router.refresh()
          }, 1000)
        } else {
          setStatus('error')
          setMessage('Authentication failed. Please try again.')
          setTimeout(() => {
            router.replace('/auth/sign-in')
          }, 2000)
        }
      } catch {
        setStatus('error')
        setMessage('Authentication service unavailable. Please try again.')
        setTimeout(() => {
          router.replace('/auth/sign-in')
        }, 2000)
      }
    }
    handleCallback()
  }, [router])

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex items-center justify-center gap-3">
          <img src="/logo.svg" alt="" className="h-10 w-auto" />
          <span className="mailpulse-logo text-xl font-bold">Mail Pulse</span>
        </div>
        <div className="flex flex-col items-center gap-4">
          {status === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-lg font-medium text-foreground">{message}</p>
              <p className="text-sm text-muted-foreground">Please wait while we verify your account...</p>
            </>
          )}
          {status === 'success' && (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-medium text-foreground">{message}</p>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                <svg className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-lg font-medium text-foreground">{message}</p>
              <p className="text-sm text-muted-foreground">Redirecting to sign in...</p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}