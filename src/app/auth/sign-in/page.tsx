'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createAuthClient } from '@neondatabase/auth/next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const auth = createAuthClient()

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
  const [googleSubmitting, setGoogleSubmitting] = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false)
  const [passwordResetComplete, setPasswordResetComplete] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

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
        const msg = result.error.message || ''
        if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('does not exist') || msg.toLowerCase().includes('user not found') || msg.toLowerCase().includes('invalid')) {
          setError('No account found with this email. Create an account first.')
          if (bootstrapAvailable) {
            setTimeout(() => router.push('/auth/initial-owner'), 2000)
          }
        } else {
          setError(msg || 'Could not sign in. Check your email and password.')
        }
        return
      }
      // Show success state before redirecting
      setError('')
      setSubmitting(false)
      toast.success('Successfully signed in! Redirecting to dashboard...')
      const btn = document.querySelector('button[type="submit"]')
      if (btn) btn.textContent = 'Signed in! Redirecting...'
      setTimeout(() => {
        router.replace(getNextPath())
        router.refresh()
      }, 800)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(`The sign-in service could not be reached: ${message}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function signInWithGoogle() {
    setGoogleSubmitting(true)
    setError('')
    try {
      await auth.signIn.social({ provider: 'google', callbackURL: window.location.origin + '/auth/callback' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(`Google sign-in could not be reached: ${message}`)
      setGoogleSubmitting(false)
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
            <Button
              type="button"
              variant="outline"
              className="w-full mb-4"
              disabled={googleSubmitting || submitting}
              onClick={signInWithGoogle}
            >
              {googleSubmitting ? 'Connecting to Google...' : (
                <>
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.19 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Sign in with Google
                </>
              )}
            </Button>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
              </div>
            </div>
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
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={submitting || googleSubmitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : 'Sign in'}
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