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

const auth = createAuthClient(process.env.NEXT_PUBLIC_NEON_AUTH_BASE_URL!, { adapter: BetterAuthReactAdapter() })

export default function ResetPasswordPage() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get('token')
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get('token')
    setToken(queryToken || fragmentToken || '')
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!token) {
      setError('This reset link is missing its token. Request a new password reset link.')
      return
    }
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const result = await auth.resetPassword({ token, newPassword: password })
      if (result.error) {
        setError(result.error.message || 'This reset link has expired. Request a new one.')
        return
      }
      router.replace('/auth/sign-in?reset=complete')
    } catch {
      setError('The password reset service could not be reached. Try again in a moment.')
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
            <CardTitle>Choose a new password</CardTitle>
            <CardDescription>Use at least 8 characters for your MailPulse account.</CardDescription>
          </CardHeader>
          <CardContent>
            {error && <div role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Updating…' : 'Update password'}
              </Button>
            </form>
            <p className="mt-5 text-center text-sm">
              <Link href="/auth/forgot-password" className="text-muted-foreground underline-offset-4 hover:underline">
                Request another reset link
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
