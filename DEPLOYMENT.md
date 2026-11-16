# MailPulse — Production Deployment

## Current status

| Piece | Where it runs | Status |
| --- | --- | --- |
| Web app + API | Vercel — https://mailpulse-sand.vercel.app | Live |
| Database | Neon PostgreSQL (shared) | Live |
| Send engine | Not hosted yet | `engine: down` on `/api/health` |
| Saved senders | Neon (`SmtpProfile`, AES-256-GCM passwords) | Live |
| Saved emails | Neon (`EmailTemplate`, subject/body/signature) | Live |
| Recipients | CSV upload, bulk paste, one-by-one tags | Live |

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
| `PORT` | `3003` |
| `SOCKET_PATH` | `/socket.io` (default; change only behind a custom proxy) |
| `UPLOAD_DIR` | `/tmp/upload` |

The engine serves socket.io, `/health`, and `/control/*` on **one port**, so any
single-port host works. Verify:
`GET https://<engine-host>/health` → `{"ok":true,...}`.

### Render (free)

`render.yaml` is a ready blueprint:

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo.
3. Set `DATABASE_URL` to the same Neon connection string Vercel uses.
4. Deploy, then copy the service URL (e.g. `https://mailpulse-engine.onrender.com`).

Render’s free web service sleeps after ~15 minutes of inactivity. The first
health check or send after that takes ~30–60 seconds to wake. Upgrading the
instance removes the cold start; no code changes are needed either way.

Railway/Fly/VPS: build `Dockerfile.engine` and expose port `3003`.

## 2. Point Vercel at the engine

Set these in **Vercel → Project → Settings → Environment Variables** (never in
`vercel.json`):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string |
| `SECRET_KEY` | Stable random key used to encrypt remembered SMTP passwords |
| `UPLOAD_DIR` | `/tmp/upload` |
| `ENGINE_URL` | Public engine URL, e.g. `https://mailpulse-engine.onrender.com` |
| `ENGINE_CONTROL_URL` | Optional; defaults to `ENGINE_URL` on the single-port engine |
| `NEXT_PUBLIC_ENGINE_URL` | Same as `ENGINE_URL`; baked in at build time |

Redeploy after changing them (`vercel deploy --prod`). The health badge turns
green when the engine responds.

`SECRET_KEY` must stay stable: rotating it makes previously saved SMTP
passwords undecryptable (they fail closed and you re-type the password once).
Use a 64-character hex value, for example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Saved senders and saved emails live in Neon, not browser storage. A new
campaign automatically loads the default sender (including its encrypted
password); saved emails restore subject, body, and signature with one click.

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
  `NEXT_PUBLIC_ENGINE_URL` and redeploy Vercel.
- `Session not found` — app and engine must use the same `DATABASE_URL`.
- Socket.io won’t connect — the engine must allow WebSockets and CORS `*`; on a
  single-port host leave `SOCKET_PATH` at `/socket.io`.
- Saved sender shows “no password” — the password was revoked or `SECRET_KEY`
  changed. Type the app password once and save the sender again.
- Mail not arriving — check session logs for SMTP auth errors, then the
  provider’s app-password settings and sending limits.
