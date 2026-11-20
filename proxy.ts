import { NextRequest, NextResponse } from 'next/server'
import { getNeonAuth } from '@/lib/neon-auth'

const publicPages = new Set([
  '/auth/sign-in',
  '/auth/accept-invite',
  '/auth/initial-owner',
  '/auth/forgot-password',
  '/auth/reset-password',
])

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (publicPages.has(pathname)) return NextResponse.next()

  const auth = getNeonAuth()
  if (!auth) {
    const signIn = new URL('/auth/sign-in', request.url)
    signIn.searchParams.set('setup', 'required')
    signIn.searchParams.set('next', pathname)
    return NextResponse.redirect(signIn)
  }

  return auth.middleware({ loginUrl: '/auth/sign-in' })(request)
}

export const config = {
  matcher: ['/((?!api/|api$|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)'],
}
