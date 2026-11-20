import { createNeonAuth } from '@neondatabase/auth/next/server'

export const INVITE_CLAIM_COOKIE = 'mailpulse_invite_claim'
export const ACTIVE_WORKSPACE_COOKIE = 'mailpulse_active_workspace'

export function getNeonAuthCookieSecret() {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET?.trim()
  return secret && secret.length >= 32 ? secret : null
}

export function getNeonAuthConfig() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim()
  const secret = getNeonAuthCookieSecret()
  if (!baseUrl || !secret) return null

  try {
    const parsed = new URL(baseUrl)
    const localDevelopmentHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
    if (parsed.protocol !== 'https:' && !localDevelopmentHost) return null
  } catch {
    return null
  }

  return {
    baseUrl,
    cookies: { secret, sessionDataTtl: 120 },
    logLevel: 'error' as const,
  }
}

export function getNeonAuth() {
  const config = getNeonAuthConfig()
  return config ? createNeonAuth(config) : null
}
