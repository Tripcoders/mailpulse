'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createAuthClient } from '@neondatabase/auth'
import { BetterAuthReactAdapter } from '@neondatabase/auth/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const auth = createAuthClient('https://ep-orange-sky-bdkpyiz5.neonauth.c-8.us-east-2.aws.neon.tech/neondb/auth', { adapter: BetterAuthReactAdapter() })
const STORED_INVITE_EMAIL = 'mailpulse-invite-email'

export default function AcceptInvitePage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'create' | 'signin'>('create')
  const [workspaceName, setWorkspaceName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loadingInvite, setLoadingInvite] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [canResendVerification, setCanResendVerification] = useState(false)
  const [resendingVerification, setResendingVerification] = useState(false)

  useEffect(() => {
    let active = true
    async function loadInvite() {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
      const storedEmail = sessionStorage.getItem(STORED_INVITE_EMAIL)
      if (!token) {
        if (storedEmail && active) {
          setEmail(storedEmail)
          setLoadingInvite(false)
          return
        }
        if (active) {
          setError('Open the invitation link you received to continue.')
          setLoadingInvite(false)
        }
        return
      }

      try {
        const response = await fetch('/api/invitations/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'This invitation is invalid or has expired.')
        sessionStorage.setItem(STORED_INVITE_EMAIL, data.email)
        window.history.replaceState(null, '', window.location.pathname)
        if (active) {
          setEmail(data.email)
          setWorkspaceName(data.workspaceName)
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not validate the invitation.')
      } finally {
        if (active) setLoadingInvite(false)
      }
    }
    loadInvite()
    return () => { active = false }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const result = mode === 'create'
        ? await auth.signUp.email({ name: name.trim(), email, password })
        : await auth.signIn.email({ email, password })
      if (result.error) {
        setError(result.error.message || 'Could not authenticate with this invitation.')
        return
      }

      const workspaceResponse = await fetch('/api/workspaces')
      const workspaceData = await workspaceResponse.json().catch(() => ({}))
      if (workspaceResponse.ok) {
        sessionStorage.removeItem(STORED_INVITE_EMAIL)
        if (typeof workspaceData.currentWorkspaceId === 'string') {
          window.localStorage.setItem('mailpulse-active-workspace-id', workspaceData.currentWorkspaceId)
        }
        router.replace('/')
        router.refresh()
        return
      }
      if (workspaceData.code === 'email_not_verified') {
        setCanResendVerification(true)
        setNotice('Verify your email using the message from Neon Auth, then reopen this invitation link.')
      } else if (workspaceData.code === 'invite_email_mismatch') {
        setError('Sign in with the email address this invitation was sent to.')
      } else {
        setNotice('Your account is ready. Verify your email if requested, then sign in again to finish joining.')
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
        email,
        callbackURL: window.location.origin + '/auth/accept-invite',
      })
      if (result.error) {
        setError(result.error.message || 'The verification email could not be sent.')
      } else {
        setNotice('Verification email sent. Verify your address, then sign in with the invited email.')
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
            <CardTitle>{loadingInvite ? 'Checking invitation…' : 'Join your workspace'}</CardTitle>
            <CardDescription>
              {workspaceName ? 'You are invited to ' + workspaceName + '.' : 'Use the email address that received the invitation.'}
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
            {!loadingInvite && email && (
              <>
                <div className="mb-5 grid grid-cols-2 gap-2">
                  <Button type="button" variant={mode === 'create' ? 'default' : 'outline'} onClick={() => setMode('create')}>
                    Create account
                  </Button>
                  <Button type="button" variant={mode === 'signin' ? 'default' : 'outline'} onClick={() => setMode('signin')}>
                    I have an account
                  </Button>
                </div>
                <form className="space-y-4" onSubmit={submit}>
                  {mode === 'create' && (
                    <div className="space-y-2">
                      <Label htmlFor="name">Name</Label>
                      <Input id="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Invited email</Label>
                    <Input id="invite-email" type="email" autoComplete="email" value={email} readOnly />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-password">Password</Label>
                    <Input
                      id="invite-password"
                      type="password"
                      autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? 'Joining…' : mode === 'create' ? 'Create account and join' : 'Sign in and join'}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
