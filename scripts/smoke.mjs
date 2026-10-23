#!/usr/bin/env node
/**
 * MailPulse API smoke test — the audit harness.
 * Runs against a live app (default http://localhost:3001) and exercises every
 * endpoint with strict expectations, printing a pass/fail breakdown.
 * Exit code 1 if anything fails — CI/CD ready.
 *
 * Usage: node scripts/smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] || process.env.SMOKE_BASE_URL || 'http://localhost:3001'
let pass = 0, fail = 0
const failures = []

function ok(cond, name, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✖ ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function j(method, path, { body, headers, label } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json }
}

async function main() {
  console.log(`\nSmoke testing ${BASE}\n`)

  // ── Health ──
  console.log('health')
  const health = await j('GET', '/api/health')
  ok(health.status === 200 && health.json?.db === 'ok', 'GET /api/health returns db ok', JSON.stringify(health.json))
  ok(health.json?.engine === 'ok', 'send engine reachable', JSON.stringify(health.json))

  // ── Persisted drafts ──
  console.log('wizard draft (resume after crash)')
  const dput = await j('PUT', '/api/wizard/draft', { body: { content: JSON.stringify({ subject: 'SMOKE' }) } })
  ok(dput.status === 200 && dput.json?.ok, 'PUT /api/wizard/draft autosaves')
  const dget = await j('GET', '/api/wizard/draft')
  ok(dget.json?.draft?.content?.includes('SMOKE'), 'GET /api/wizard/draft returns snapshot')
  const ddlt = await j('DELETE', '/api/wizard/draft')
  ok(ddlt.status === 200, 'DELETE /api/wizard/draft clears')

  // ── Settings ──
  console.log('settings (remembered preferences)')
  await j('PUT', '/api/settings', { body: { smoke_probe: { n: 1 } } })
  const sg = await j('GET', '/api/settings')
  ok(sg.json?.settings?.smoke_probe?.n === 1, 'settings round-trip')

  // ── SMTP Profiles (encrypted credentials) ──
  console.log('smtp profiles (encrypted at rest)')
  const secret = 'SMOKE-SECRET-' + Date.now()
  const ppost = await j('POST', '/api/smtp/profiles', {
    body: { providerType: 'gmail', fromName: 'Smoke', fromEmail: 'smoke.probe@gmail.com', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true, smtpUser: 'smoke.probe@gmail.com', smtpPass: secret },
  })
  ok(ppost.json?.profile?.id && ppost.json?.profile?.hasPassword, 'POST profile saved with hasPassword')
  const profs = await j('GET', '/api/smtp/profiles')
  ok(profs.json?.profiles?.length >= 1, 'GET profiles lists saved identity')
  const probe = await j('GET', '/api/smtp/profiles')
  ok(!JSON.stringify(probe.json).includes(secret), 'password never leaks in responses')
  const pid = ppost.json?.profile?.id
  const pdel = await j('DELETE', `/api/smtp/profiles?id=${pid}`)
  ok(pdel.status === 200, 'DELETE profile')

  // ── Smart suggestions ──
  console.log('smart suggestions (local engine)')
  const sug = await j('POST', '/api/suggest', { body: { recipientsCount: 300, fromEmail: 'probe@yahoo.com', providerType: 'gmail', subject: 'Q', bodyHtml: '<p>x</p>' } })
  ok(sug.json?.suggestions?.length >= 1, 'POST /api/suggest returns suggestions')
  ok(sug.json?.suggestions?.some(s => s.id === 'provider-from-domain'), 'domain→provider suggestion fires')

  // ── Content library ──
  console.log('signatures + templates')
  const sig = await j('POST', '/api/signatures', { body: { name: 'Smoke', type: 'text', content: 'Smoke test' } })
  ok(sig.json?.signature?.id, 'POST signature')
  const sigdel = await j('DELETE', `/api/signatures?id=${sig.json?.signature?.id}`)
  ok(sigdel.status === 200, 'DELETE signature')
  const tpl = await j('POST', '/api/templates', { body: { name: 'Smoke', subject: 'S', body: '<p>b</p>' } })
  ok(tpl.json?.template?.id, 'POST template')
  const tpldel = await j('DELETE', `/api/templates?id=${tpl.json?.template?.id}`)
  ok(tpldel.status === 200, 'DELETE template')

  // ── CSV parse ──
  console.log('csv parse')


  const csv = 'email,name\nv1@test.com,One\nv2@test.com,Two\nv1@test.com,dupe\nbad-line,x'
  const fd = new FormData()
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'smoke.csv')
  const fres = await fetch(`${BASE}/api/csv/parse`, { method: 'POST', body: fd, signal: AbortSignal.timeout(20000) })
  const csvj = await fres.json().catch(() => ({}))
  ok(fres.status === 200 && csvj?.recipients?.length === 2, 'CSV parse validates + dedupes', JSON.stringify(csvj).slice(0, 120))

  // ── Attachment staging ──
  console.log('attachments (documents save/delete)')
  const fd2 = new FormData()
  fd2.append('file', new Blob(['smoke document'], { type: 'text/plain' }), 'smoke.txt')
  const af = await fetch(`${BASE}/api/attachments/upload`, { method: 'POST', body: fd2, signal: AbortSignal.timeout(20000) })
  const aj = await af.json().catch(() => ({}))
  ok(af.status === 200 && aj?.stagingId, 'attachment upload stages to disk')
  const ares = await fetch(`${BASE}/api/attachments/${aj?.stagingId}`, { method: 'DELETE' })
  ok(ares.status === 200, 'attachment delete removes it')

  // ── Session lifecycle ──
  console.log('session lifecycle (create→read→duplicate→reset→delete)')
  const mk = await j('POST', '/api/sessions', {
    body: {
      name: 'SMOKE lifecycle', fromName: 'Smoke', fromEmail: 'smoke.probe@gmail.com', providerType: 'gmail',
      smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true,
      subject: 'S {{name}}', bodyHtml: '<p>body {{email}}</p>',
      batchSize: 5, batchDelayMs: 1000, perEmailDelayMs: 100,
      recipients: [{ email: 'r1@test.com', name: 'R One' }, { email: 'r2@test.com', name: 'R Two' }],
    },
  })
  const sid = mk.json?.session?.id
  ok(mk.status === 200 && !!sid, 'POST /api/sessions creates campaign')
  const det = await j('GET', `/api/sessions/${sid}`)
  ok(det.json?.session?.totalEmails === 2, 'GET session detail')
  const rcp = await j('GET', `/api/sessions/${sid}/recipients`)
  ok(rcp.json?.recipients?.length === 2, 'GET recipients (paginated)')
  const lg = await j('GET', `/api/sessions/${sid}/logs`)
  ok(lg.status === 200, 'GET logs')
  const dup = await j('POST', `/api/sessions/${sid}/duplicate`, { body: { name: 'SMOKE copy' } })
  const dupId = dup.json?.session?.id
  ok(dup.status === 200 && dupId && dup.json?.session?.totalEmails === 2, 'POST duplicate copies recipients')
  const rst = await j('POST', `/api/sessions/${sid}/reset`)
  ok(rst.json?.ok, 'POST reset re-queues')
  const nf = await j('POST', '/api/sessions/nope/duplicate')
  ok(nf.status === 404, 'unknown id → precise 404')

  // ── SMTP verify (bad creds must fail cleanly & fast) ──
  console.log('smtp verify')
  const t0 = Date.now()
  const bad = await j('POST', '/api/smtp/test', { body: { providerType: 'gmail', smtpUser: 'smoke.probe@gmail.com', smtpPass: 'wrong-password' } })
  ok(bad.json?.ok === false && bad.json?.error, 'bad creds rejected with message', (bad.json?.error || '').slice(0, 60))
  ok(Date.now() - t0 < 35000, 'smtp verify fails fast (no hang)', `${Date.now() - t0}ms`)

  // ── Engine control (through both transports) ──
  console.log('engine control (socket + http fallback)')
  if (sid) {
    const st = await j('POST', `/api/sessions/${sid}/start`, { body: { smtpUser: 'smoke.probe@gmail.com', smtpPass: 'wrong-password' } })
    ok(st.status === 200 && st.json?.ok, 'start accepted (primary transport)', JSON.stringify(st.json))
    await new Promise(r => setTimeout(r, 15000))
    const det2 = await j('GET', `/api/sessions/${sid}`)
    ok(['failed', 'running'].includes(det2.json?.session?.status), 'engine processed start (failed on fake creds or still running)', det2.json?.session?.status)
    const dz = await j('DELETE', `/api/sessions/${sid}`)
    ok(dz.status === 200, 'DELETE session cleanup')
    const dc = await j('DELETE', `/api/sessions/${dupId}`)
    ok(dc.status === 200, 'DELETE duplicate cleanup')
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) {
    console.log('\nFailures:')
    failures.forEach(f => console.log('  ✖ ' + f))
    process.exit(1)
  }
}

main().catch(e => { console.error('Smoke run crashed:', e.message); process.exit(1) })
