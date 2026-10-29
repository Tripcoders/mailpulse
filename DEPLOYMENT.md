# MailPulse — Full Email Sending Infrastructure Setup

## Overview
MailPulse has two components:
1. **Web App** (Next.js) — Runs on Vercel (or any Node.js host)
2. **Send Engine** (Node.js) — Long-running process that sends emails via SMTP

For email sending to work, both must be running and connected to the same database.

## Architecture
```
┌─────────────┐     HTTP/WS      ┌──────────────┐     SMTP     ┌──────────┐
│  Vercel App  │ ◄──────────────► │ Send Engine  │ ──────────► │  Gmail/   │
│  (Next.js)   │                  │ (Railway/    │             │  SMTP     │
│              │                  │  Render/Fly) │             │  Server   │
└──────┬──────┘                  └──────┬───────┘             └──────────┘
       │                                │
       └────────┬───────────────────────┘
                │
         ┌──────┴──────┐
         │  PostgreSQL  │
         │  (Neon/      │
         │  Supabase)   │
         └─────────────┘
```

## Step 1: Set Up Cloud Database (PostgreSQL)

### Option A: Neon (Recommended - Free)
1. Go to https://neon.tech
2. Create account → Create project
3. Copy the connection string (starts with `postgresql://`)
4. Save it for later

### Option B: Supabase (Free)
1. Go to https://supabase.com
2. Create account → Create project
3. Go to Settings → Database → Connection string
4. Copy the URI (starts with `postgresql://`)

### Option C: Vercel Postgres
1. Go to Vercel Dashboard → Storage → Create Database
2. Select Postgres
3. Copy the connection string

## Step 2: Deploy Send Engine

### Option A: Railway (Recommended - Free tier)
1. Go to https://railway.app
2. Create account → New Project → Deploy from GitHub
3. Select your repo → Set root directory to `/`
4. Set Dockerfile path: `Dockerfile.engine`
5. Add environment variables:
   - `DATABASE_URL` = your PostgreSQL connection string
   - `PORT` = 3003
   - `CONTROL_PORT` = 3004
   - `UPLOAD_DIR` = /tmp/upload
6. Deploy
7. Note the public URL (e.g., `https://mailpulse-engine.up.railway.app`)

### Option B: Render (Free tier)
1. Go to https://render.com
2. Create account → New → Web Service
3. Connect GitHub repo
4. Set Dockerfile path: `Dockerfile.engine`
5. Add environment variables (same as above)
6. Deploy
7. Note the public URL

### Option C: Fly.io
1. Install flyctl: `curl -L https://fly.io/install.sh | sh`
2. Run: `fly launch --dockerfile Dockerfile.engine`
3. Set secrets: `fly secrets set DATABASE_URL=... PORT=3003 CONTROL_PORT=3004`
4. Deploy: `fly deploy`

## Step 3: Configure Vercel App

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Update/Add these variables:
   - `DATABASE_URL` = your PostgreSQL connection string (same as engine)
   - `ENGINE_URL` = `https://your-engine-url:3003` (from Step 2)
   - `ENGINE_CONTROL_URL` = `https://your-engine-url:3004` (from Step 2)
   - `UPLOAD_DIR` = (remove or leave empty - not needed on Vercel)
   - `SECRET_KEY_PATH` = (remove or leave empty - key is auto-generated)
3. Redeploy: `vercel deploy --prod`

## Step 4: Initialize Database Schema

Run this once to create all tables:
```bash
# Set your DATABASE_URL
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# Push schema
npx prisma db push --schema=prisma/schema.postgresql.prisma --accept-data-loss
```

## Step 5: Test Email Sending

1. Visit your Vercel app URL
2. Create a campaign (name, recipients, subject, body)
3. Configure SMTP (Gmail, Yahoo, or custom)
4. Click "Launch"
5. Watch real-time progress via socket.io
6. Check the engine logs on Railway/Render for send status

## Environment Variables Summary

### Vercel (Web App)
| Variable | Value |
|----------|-------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ENGINE_URL` | `https://your-engine:3003` |
| `ENGINE_CONTROL_URL` | `https://your-engine:3004` |
| `NODE_ENV` | `production` |

### Engine (Railway/Render/Fly)
| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Same PostgreSQL connection string |
| `PORT` | `3003` |
| `CONTROL_PORT` | `3004` |
| `UPLOAD_DIR` | `/tmp/upload` |

## Notes
- The engine needs to be running for email sending to work
- If the engine is down, the app still works for campaign creation/management
- The health check on Vercel will show "engine: down" if the engine isn't reachable
- For local development, use the Docker setup: `docker compose up -d`
- For staging/testing without email sending, Vercel alone is sufficient

## Switching Between SQLite and PostgreSQL

For local development (SQLite):
```bash
# Use the default schema
npx prisma db push  # Uses prisma/schema.prisma (SQLite)
```

For cloud deployment (PostgreSQL):
```bash
# Use the PostgreSQL schema
npx prisma db push --schema=prisma/schema.postgresql.prisma
```

## Troubleshooting

### "Engine down" on health check
- Verify the engine is running: `curl https://your-engine:3004/health`
- Check ENGINE_URL and ENGINE_CONTROL_URL env vars on Vercel
- Ensure the engine's CORS allows your Vercel domain

### Database connection errors
- Verify DATABASE_URL is correct
- Ensure the database allows connections from Vercel's IP ranges
- Check if the schema was pushed: `npx prisma db push`

### Socket.io not connecting
- The browser connects to ENGINE_URL for WebSocket
- Ensure the engine's socket.io server is running
- Check browser console for connection errors
- Verify CORS settings on the engine