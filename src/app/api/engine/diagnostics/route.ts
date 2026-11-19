import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type WorkerHealth = {
  ok?: unknown
  database?: unknown
  recovery?: unknown
  lease?: unknown
  controlAuth?: unknown
}

function allowedValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined
}

function recommendations(code: string, controlTokenConfigured: boolean) {
  const steps: string[] = []

  if (code === 'missing_engine_url') {
    steps.push('Deploy the sender as a persistent service, then set ENGINE_URL and ENGINE_CONTROL_URL in the Vercel project to its stable HTTPS address.')
  } else if (code === 'health_endpoint_not_found') {
    steps.push('The configured host answered, but /health was not found. Replace any expired tunnel or wrong host with the sender service URL.')
  } else if (code === 'worker_database_down' || code === 'worker_database_misconfigured') {
    steps.push('Set the sender DATABASE_URL to the same reachable Neon PostgreSQL branch used by MailPulse, then check the worker startup logs and migration state.')
  } else if (code === 'worker_recovery_degraded' || code === 'worker_starting') {
    steps.push('Review the sender startup logs for Neon recovery failures and wait until /health reports recovery ready.')
  } else if (code === 'worker_lease_waiting') {
    steps.push('Check for another worker instance holding the sender lease. Keep one active sender instance and wait for its health check to become ready.')
  } else if (code === 'worker_control_auth_missing') {
    steps.push('Set ENGINE_API_TOKEN on the sender service and the Vercel app to the same long random value, then redeploy both.')
  } else if (code === 'health_endpoint_denied') {
    steps.push('Allow the Vercel server to reach the worker health endpoint over HTTPS. Keep campaign controls authenticated; the health route must not be behind an interactive login page.')
  } else if (code === 'timeout' || code === 'dns_failure' || code === 'connection_refused' || code === 'unreachable') {
    steps.push('Start the sender on a persistent host and point Vercel at its stable HTTPS URL. A temporary Cloudflare tunnel will stop working when its tunnel process ends.')
  } else if (code === 'worker_not_ready') {
    steps.push('The worker answered but is not ready. Check Neon connectivity, startup recovery, and the sender lease in its host logs.')
  } else if (code === 'invalid_engine_url') {
    steps.push('Correct ENGINE_URL or ENGINE_CONTROL_URL to a valid HTTP(S) URL for the sender service, then redeploy the Vercel app.')
  } else if (code === 'http_error') {
    steps.push('Inspect the sender host response and logs, then verify the configured URL points to the worker rather than the web app.')
  } else {
    steps.push('Run the sender on a persistent host, connect it to Neon, and verify its /health endpoint before launching a campaign.')
  }

  if (!controlTokenConfigured) {
    steps.push('ENGINE_API_TOKEN is not configured in the Vercel app. Configure the same secret in the app and sender before enabling campaign controls.')
  }

  steps.push('After the checks pass, verify the SMTP profile in MailPulse and send a test to an address you control before a larger campaign.')
  return steps
}

function result(
  status: 'ok' | 'down',
  code: string,
  message: string,
  fields: Record<string, unknown>,
  httpStatus = status === 'ok' ? 200 : 503,
) {
  return NextResponse.json(
    { status, code, message, ...fields, repairSteps: recommendations(code, Boolean(fields.controlTokenConfigured)) },
    { status: httpStatus, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function GET() {
  const checkedAt = new Date().toISOString()
  const controlUrl = process.env.ENGINE_CONTROL_URL?.trim() || process.env.ENGINE_URL?.trim() || ''
  const configured = Boolean(controlUrl)
  const controlTokenConfigured = Boolean(process.env.ENGINE_API_TOKEN?.trim())
  const common = { configured, controlTokenConfigured, checkedAt }

  if (!configured && process.env.NODE_ENV === 'production') {
    return result('down', 'missing_engine_url', 'No sender URL is configured for this deployment.', common)
  }

  const baseUrl = controlUrl || 'http://localhost:3003'
  let healthUrl: URL
  try {
    healthUrl = new URL(`${baseUrl.replace(/\/+$/, '')}/health`)
    if (!['http:', 'https:'].includes(healthUrl.protocol)) throw new Error('unsupported protocol')
  } catch {
    return result('down', 'invalid_engine_url', 'The configured sender URL is not a valid HTTP(S) address.', common)
  }

  try {
    const response = await fetch(healthUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    const payload = await response.json().catch(() => null) as WorkerHealth | null
    const worker = payload ? {
      database: allowedValue(payload.database, ['ok', 'down', 'misconfigured'] as const),
      recovery: allowedValue(payload.recovery, ['starting', 'ready', 'degraded'] as const),
      lease: allowedValue(payload.lease, ['held', 'waiting'] as const),
      controlAuth: allowedValue(payload.controlAuth, ['ok', 'missing'] as const),
    } : undefined
    const fields = { ...common, httpStatus: response.status, worker }

    if (response.status === 404) {
      return result('down', 'health_endpoint_not_found', 'The sender host responded, but its /health endpoint was not found. The URL may point to the wrong service or an expired tunnel.', fields)
    }
    if (response.status === 401 || response.status === 403) {
      return result('down', 'health_endpoint_denied', 'The sender health endpoint is blocked from the Vercel server.', fields)
    }
    if (worker?.database === 'misconfigured') {
      return result('down', 'worker_database_misconfigured', 'The sender is running, but it is not configured to use PostgreSQL.', fields)
    }
    if (worker?.database === 'down') {
      return result('down', 'worker_database_down', 'The sender is running, but it cannot connect to its Neon database.', fields)
    }
    if (worker?.controlAuth === 'missing') {
      return result('down', 'worker_control_auth_missing', 'The sender is running, but its control token is not configured.', fields)
    }
    if (worker?.recovery === 'degraded') {
      return result('down', 'worker_recovery_degraded', 'The sender connected to its host but startup recovery failed.', fields)
    }
    if (worker?.recovery === 'starting') {
      return result('down', 'worker_starting', 'The sender is still recovering its database state.', fields)
    }
    if (worker?.lease === 'waiting') {
      return result('down', 'worker_lease_waiting', 'The sender is waiting for its delivery lease.', fields)
    }
    if (!response.ok || payload?.ok === false) {
      return result('down', 'worker_not_ready', 'The sender responded but is not ready to accept campaigns.', fields)
    }
    if (!payload || typeof payload !== 'object') {
      return result('down', 'http_error', 'The sender health endpoint returned an unreadable response.', fields)
    }
    if (!controlTokenConfigured) {
      return result('down', 'app_control_token_missing', 'The sender is reachable, but the Vercel app has no ENGINE_API_TOKEN configured.', common)
    }

    return result('ok', 'reachable', 'The sender is reachable and reports ready to accept campaigns.', fields)
  } catch (error) {
    const causeCode = (error as { cause?: { code?: string }; name?: string })?.cause?.code
    const errorName = (error as { name?: string })?.name
    if (errorName === 'TimeoutError' || errorName === 'AbortError') {
      return result('down', 'timeout', 'The sender did not answer its health check within five seconds.', common)
    }
    if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') {
      return result('down', 'dns_failure', 'The sender hostname could not be resolved.', common)
    }
    if (causeCode === 'ECONNREFUSED') {
      return result('down', 'connection_refused', 'The sender host refused the health check. The worker may not be running.', common)
    }
    return result('down', 'unreachable', 'The Vercel server could not reach the sender health endpoint.', common)
  }
}
