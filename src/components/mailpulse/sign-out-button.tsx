'use client'

import { useState } from 'react'
import { createAuthClient } from '@neondatabase/auth/next'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

const auth = createAuthClient()

export function SignOutButton() {
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    try {
      await auth.signOut()
    } finally {
      window.location.assign('/auth/sign-in')
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      aria-label="Sign out"
      title="Sign out"
      disabled={pending}
      onClick={signOut}
    >
      <LogOut className="h-4 w-4" />
    </Button>
  )
}
