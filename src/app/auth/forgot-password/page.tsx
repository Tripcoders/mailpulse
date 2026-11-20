'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { createAuthClient } from '@neondatabase/auth/next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const auth = createAuthClient()

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      await auth.requestPasswordReset({
        email: email.trim(),
        redirectTo: window.location.origin + '/auth/reset-password',
      })
      setNotice('If an account uses that address, Neon Auth will send a password reset link.')
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
            <CardTitle>Reset your password</CardTitle>
            <CardDescription>Enter the email address for your MailPulse account.</CardDescription>
          </CardHeader>
          <CardContent>
            {error && <div role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
            {notice && <div role="status" className="mb-4 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-950">{notice}</div>}
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input id="reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
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
