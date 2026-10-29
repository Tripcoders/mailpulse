# MailPulse — Full Email Sending Setup Guide

## Current Status
- ✅ Vercel app is live: https://mailpulse-sand.vercel.app
- ✅ Database (Neon PostgreSQL) is set up and working
- ❌ Send Engine is NOT deployed (needs to be on Railway/Render)
- ❌ Email sending requires the engine to be running

## The Problem
The Send Engine is a long-running Node.js process (socket.io + HTTP control plane). Vercel's serverless platform can't run it. The engine must be deployed to a platform that supports long-running processes.

## Architecture
```
┌──────────────┐  HTTP/WS  ┌──────────────┐  SMTP  ┌──────────┐
│ Vercel App   │◄─────────►│ Send Engine  │───────►│ Gmail/   │
│ (Next.js)    │           │ (Railway)    │        │ SMTP     │
└──────┬───────┘           └──────┬───────┘        └──────────┘
       │                          │
       └────────┬─────────────────┘
                │
         ┌──────┴──────┐
         │  Neon DB    │  (already set up!)
         └─────────────┘
```

## Step 1: Deploy Send Engine to Railway (5 minutes)

### 1.1 Create Railway Account
1. Go to https://railway.app
2. Click "Login" → "Login with GitHub"
3. Authorize Railway to access your GitHub

### 1.2 Create New Project
1. Click "New Project"
2. Select "Deploy from GitHub repo"
3. Choose "Tripcoders/mailpulse"
4. Railway will detect the Dockerfile

### 1.3 Configure the Service
1. Click on the service → "Settings"
2. Set **Root Directory** to `/` (default)
3. Set **Dockerfile Path** to `Dockerfile.engine`
4. Set **Build Command** to: (leave empty, Dockerfile handles it)

### 1.4 Add Environment Variables
Click "Variables" tab → Add these:
| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgresql://neondb_owner:npg_H7nmMw6DSgyx@ep-billowing-base-b5spy13r-pooler.c-7.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require` |
| `PORT` | `3003` |
| `CONTROL_PORT` | `3004` |
| `UPLOAD_DIR` | `/tmp/upload` |

### 1.5 Deploy
1. Click "Deploy"
2. Wait for build to complete (~2-3 minutes)
3. Note the public URL (e.g., `https://mailpulse-engine-production.up.railway.app`)

### 1.6 Verify Engine
Visit: `https://your-engine-url/health`
Should return: `{"ok":true,"uptime":...,"runtimeSessions":0}`

## Step 2: Configure Vercel (2 minutes)

### 2.1 Update Environment Variables
Go to Vercel Dashboard → Your Project → Settings → Environment Variables

Update these (or add if missing):
| Variable | Value |
|----------|-------|
| `DATABASE_URL` | (same Neon connection string as above) |
| `ENGINE_URL` | `https://your-engine-url:3003` |
| `ENGINE_CONTROL_URL` | `https://your-engine-url:3004` |
| `NEXT_PUBLIC_ENGINE_URL` | `https://your-engine-url:3003` |

### 2.2 Redeploy
```bash
vercel deploy --prod
```

## Step 3: Test Email Sending

1. Visit https://mailpulse-sand.vercel.app
2. Check health indicator shows "All systems go" (green dot)
3. Create a campaign:
   - Name: "Test Campaign"
   - Upload CSV with your email
   - Compose subject + body
   - Configure SMTP (Gmail/Yahoo/custom)
4. Click "Launch"
5. Watch real-time progress on the session page
6. Check your inbox for the email!

## Alternative: Render (Free Tier)

If Railway doesn't work, try Render:

1. Go to https://render.com → New → Web Service
2. Connect GitHub repo
3. Set Dockerfile path: `Dockerfile.engine`
4. Add environment variables (same as above)
5. Deploy (free tier may sleep after 15 min of inactivity)

## Alternative: Run Locally (Already Works!)

If you just want to test email sending now:
```bash
# Start the full stack
docker compose up -d

# Access at http://localhost:8088
# Everything works including email sending!
```

## Troubleshooting

### "Engine down" on Vercel
- Verify engine is running: `curl https://your-engine-url/health`
- Check ENGINE_URL and ENGINE_CONTROL_URL env vars on Vercel
- Ensure the engine's CORS allows your Vercel domain (already set to `*`)

### "Session not found" error
- Engine and app must use the SAME database (Neon PostgreSQL)
- Verify DATABASE_URL is identical on both Vercel and engine

### Socket.io not connecting
- Browser connects to ENGINE_URL for WebSocket
- Ensure the engine is accessible from the browser
- Check browser console for connection errors

### Emails not sending
- Verify SMTP credentials are correct
- Check if your email provider blocks the server's IP
- Look at engine logs on Railway/Render dashboard
- Check the session logs in the app

## Important Notes
- The Neon database is temporary (expires Nov 1, 2026) - claim it at https://neon.tech
- Quick tunnels (cloudflared) are NOT suitable for production - use Railway/Render
- For local development, use the Docker setup which works completely
- The Vercel deployment is best for UI/staging; email sending needs the engine