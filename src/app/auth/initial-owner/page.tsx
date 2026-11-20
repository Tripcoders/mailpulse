'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createAuthClient } from '@neondatabase/auth'
import { BetterAuthReactAdapter } from '@neondatabase/auth/react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff } from 'lucide-react'

const auth = createAuthClient('https://ep-orange-sky-bdkpyiz5.neonauth.c-8.us-east-2.aws.neon.tech/neondb/auth', { adapter: BetterAuthReactAdapter() })

export default function InitialOwnerPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [canResendVerification, setCanResendVerification] = useState(false)
  const [resendingVerification, setResendingVerification] = useState(false)

  useEffect(() => {
    fetch('/api/bootstrap/status')
      .then(async (response) => {
        const data = await response.json()
        setAvailable(response.ok && data.available === true)
        if (!response.ok && data.error) setError(data.error)
      })
      .catch(() => {
        setAvailable(false)
        setError('Could not check the Neon workspace setup.')
      })
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const result = await auth.signUp.email({ name: name.trim(), email: email.trim(), password })
      if (result.error) {
        setError(result.error.message || 'Could not create the initial owner account.')
        return
      }

      const response = await fetch('/api/workspaces')
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        if (typeof data.currentWorkspaceId === 'string') {
          window.localStorage.setItem('mailpulse-active-workspace-id', data.currentWorkspaceId)
        }
        toast.success('Account created successfully! Redirecting to dashboard...')
        router.replace('/')
        router.refresh()
        return
      }
      if (data.code === 'email_not_verified' || response.status === 401) {
        setCanResendVerification(true)
        setNotice('Verify your email using the message from Neon Auth. Then sign in to finish workspace setup.')
      } else {
        setError(data.error || 'The initial workspace could not be created. Check the Neon setup and try again.')
      }
    } catch {
      setError('The authentication service could not be reached. Try again in a moment.')
    } finally {
      setSubmitting(false)
    }
  }

  async function resendVerificationEmail() {
    setResendingVerification(true)
    setError('')
    try {
      const result = await auth.sendVerificationEmail({
        email: email.trim(),
        callbackURL: window.location.origin + '/auth/initial-owner',
      })
      if (result.error) {
        setError(result.error.message || 'The verification email could not be sent.')
      } else {
        setNotice('Verification email sent. Verify the address, then sign in and reopen first-owner setup.')
      }
    } catch {
      setError('The verification email service could not be reached. Try again in a moment.')
    } finally {
      setResendingVerification(false)
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
            <CardTitle>Set up the first workspace owner</CardTitle>
            <CardDescription>
              This one-time setup is limited to the address configured as NEON_INITIAL_OWNER_EMAIL.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {notice && (
              <div role="status" className="mb-4 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-950">
                {notice}
                {canResendVerification && (
                  <Button type="button" variant="outline" className="mt-3 w-full" disabled={resendingVerification} onClick={resendVerificationEmail}>
                    {resendingVerification ? 'Sending…' : 'Resend verification email'}
                  </Button>
                )}
              </div>
            )}
            {available === false && !notice ? (
              <p className="text-sm text-muted-foreground">
                First-owner setup is unavailable. Neon Auth, the workspace migration, and the initial owner address must be configured.
              </p>
            ) : (
              <form className="space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="owner-name">Name</Label>
                  <Input id="owner-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-email">Email</Label>
                  <Input id="owner-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="owner-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      minLength={8}
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
                <Button type="submit" className="w-full" disabled={submitting || available !== true}>
                  {submitting ? 'Setting up…' : 'Create owner account'}
                </Button>
              </form>
            )}
            <p className="mt-5 text-center text-sm">
              <Link href="/auth/sign-in" className="text-muted-foreground underline-offset-4 hover:underline">
                Back to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
