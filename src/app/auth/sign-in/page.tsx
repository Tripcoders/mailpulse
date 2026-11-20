'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createAuthClient } from '@neondatabase/auth'
import { BetterAuthReactAdapter } from '@neondatabase/auth/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const auth = createAuthClient('https://ep-orange-sky-bdkpyiz5.neonauth.c-8.us-east-2.aws.neon.tech/neondb/auth', { adapter: BetterAuthReactAdapter() })

function getNextPath() {
  if (typeof window === 'undefined') return '/'
  const requested = new URLSearchParams(window.location.search).get('next')
  if (!requested) return '/'
  try {
    const target = new URL(requested, window.location.origin)
    return target.origin === window.location.origin
      ? target.pathname + target.search + target.hash
      : '/'
  } catch {
    return '/'
  }
}

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false)
  const [passwordResetComplete, setPasswordResetComplete] = useState(false)

  useEffect(() => {
    setSetupRequired(new URLSearchParams(window.location.search).get('setup') === 'required')
    setPasswordResetComplete(new URLSearchParams(window.location.search).get('reset') === 'complete')
    fetch('/api/bootstrap/status')
      .then((response) => response.json())
      .then((data) => setBootstrapAvailable(data.available === true))
      .catch(() => setBootstrapAvailable(false))
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const result = await auth.signIn.email({ email: email.trim(), password })
      if (result.error) {
        setError(result.error.message || 'Could not sign in. Check your email and password.')
        return
      }
      router.replace(getNextPath())
      router.refresh()
    } catch {
      setError('The sign-in service could not be reached. Try again in a moment.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <img src="/logo.svg" alt="" className="h-10 w-auto" />
          <span className="font-[family-name:var(--font-jakarta)] text-xl font-bold">Mail Pulse</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in to your workspace</CardTitle>
            <CardDescription>Use your MailPulse account to manage campaigns and sender profiles.</CardDescription>
          </CardHeader>
          <CardContent>
            {setupRequired && (
              <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                Neon Auth is not configured yet. Set the Neon Auth URL and cookie secret before using this deployment.
              </div>
            )}
            {passwordResetComplete && (
              <div role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950">
                Your password was updated. Sign in with the new password.
              </div>
            )}
            {error && (
              <div role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
            <p className="mt-5 text-center text-sm text-muted-foreground">
              MailPulse workspaces are invite-only. Ask a workspace owner for an invitation link.
            </p>
            <p className="mt-3 text-center text-sm">
              <Link href="/auth/forgot-password" className="text-muted-foreground underline-offset-4 hover:underline">
                Forgot your password?
              </Link>
            </p>
            {bootstrapAvailable && (
              <p className="mt-3 text-center text-sm">
                <Link href="/auth/initial-owner" className="font-medium text-primary underline-offset-4 hover:underline">
                  Set up the first workspace owner
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
