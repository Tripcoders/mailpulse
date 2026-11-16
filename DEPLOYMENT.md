# MailPulse — Production Deployment

## Current status

| Piece | Where it runs | Status |
| --- | --- | --- |
| Web app + API | Vercel — https://mailpulse-sand.vercel.app | Live |
| Database | Neon PostgreSQL (shared) | Live |
| Send engine | Not hosted yet | `engine: down` on `/api/health` |
| Recipients | CSV upload, bulk paste, one-by-one | Live |

The app can build a campaign and save every recipient in Neon without the engine.
Actually delivering mail needs the engine (below), plus a real SMTP app password.

## Architecture

```
Vercel (Next.js UI + API) ──HTTP/WebSocket──► Send engine ──SMTP──► Gmail/Outlook/…
            │                                    │
            └──────────────┬─────────────────────┘
                     Neon PostgreSQL
```

## 1. Host the send engine

The repo already contains everything a host needs:

- `Dockerfile.engine` — build with `--build-arg SCHEMA=postgresql`
- `render.yaml` — Render blueprint (Docker, health check `/health`)
- `railway.json` — Railway Dockerfile config

Set these on the host:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Same Neon connection string as Vercel |
| `PORT` | `3003` (socket.io) |
| `CONTROL_PORT` | `3004` (HTTP control + health) |
| `UPLOAD_DIR` | `/tmp/upload` |

Verify: `GET https://<engine-host>:3004/health` → `{"ok":true,...}`.
Most hosts expose one public port; route the public port to `CONTROL_PORT` and
expose `PORT` separately, or put both behind one reverse proxy.

## 2. Point Vercel at the engine

Set these in **Vercel → Project → Settings → Environment Variables** (never in
`vercel.json`):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string |
| `SECRET_KEY` | Stable random key used to encrypt remembered SMTP passwords |
| `UPLOAD_DIR` | `/tmp/upload` |
| `ENGINE_URL` | Public socket.io URL, e.g. `https://engine.example.com` |
| `ENGINE_CONTROL_URL` | Public control URL, e.g. `https://engine-control.example.com` |
| `NEXT_PUBLIC_ENGINE_URL` | Same as `ENGINE_URL`; baked in at build time |

Redeploy after changing them (`vercel deploy --prod`). The health badge turns
green when the engine responds.

`SECRET_KEY` must stay stable: rotating it makes previously saved SMTP
passwords undecryptable (they fail closed and you re-type the password once).
Use a 64-character hex value, for example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Test a real send

1. Create a campaign, add one recipient (your own address), write a subject/body.
2. Use a provider app password (Gmail requires 2FA + an App Password).
3. Click **Test connection** — expect “SMTP connection verified”.
4. Launch and watch the session page for live progress and per-recipient status.

## Operational notes

- **Neon project is unclaimed.** The local `neonctl` claim expired; claim the
  project at https://neon.tech to avoid expiry. Rotate the DB password if this
  repository has ever been shared publicly.
- **Attachments + external engine.** Vercel stages uploads in `/tmp`, which the
  engine cannot read. Attachments currently send with a “Could not read
  attachment” warning (the email still goes out). Use shared object storage
  (S3/R2/Vercel Blob) before relying on attachments in production.
- **Local development** works fully with `docker compose up -d` (app on
  `http://localhost:8088`, app + engine + SQLite share a volume).
- **Quick tunnels** (`trycloudflare.com`) are fine for a demo but the URL changes
  every restart. Don’t use them for production.
- **`vercel.json` contains no secrets.** All environment values live in Vercel’s
  encrypted project settings.

## Troubleshooting

- `engine: down` — check the engine’s `/health`, then `ENGINE_URL` /
  `ENGINE_CONTROL_URL` and redeploy Vercel.
- `Session not found` — app and engine must use the same `DATABASE_URL`.
- Socket.io won’t connect — the engine must allow WebSockets and CORS `*`.
- Mail not arriving — check session logs for SMTP auth errors, then the
  provider’s app-password settings and sending limits.
