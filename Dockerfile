# ─────────────────────────────────────────────────────────────
# MailPulse release image — one file, two targets:
#   docker compose build web engine
# web    → Next.js standalone server (campaign UI + API)
# engine → bundled email-sender mini-service (socket.io + control HTTP)
# Runtime data lives in /data (mounted volume shared by both containers):
#   /data/db/mailpulse.db   SQLite database
#   /data/db/secret.key     password-encryption key (auto-created)
#   /data/upload/…          staged attachments
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ── Web: deps ──
FROM base AS web-deps
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps 2>/dev/null || npm install --legacy-peer-deps

# ── Web: build ──
FROM base AS web-build
COPY --from=web-deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# ── Web runtime ──
FROM base AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    UPLOAD_DIR=/data/upload \
    SECRET_KEY_PATH=/data/db/secret.key \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-deps /app/node_modules ./node_modules
COPY --from=web-build /app/.next/standalone ./
COPY --from=web-build /app/.next/static ./.next/static
COPY --from=web-build /app/public ./public
COPY --from=web-build /app/prisma ./prisma
# Initialize the SQLite schema on first boot, then serve
CMD ["sh", "-c", "if [ ! -f /data/db/mailpulse.db ]; then (mkdir -p /data/db) && (npx prisma db push --skip-generate --accept-data-loss); fi; node server.js"]

# ── Engine: build ──
FROM base AS engine-build
WORKDIR /engine
COPY mini-services/email-sender/package.json mini-services/email-sender/package-lock.json* ./
COPY mini-services/email-sender/index.ts ./
COPY prisma/schema.prisma ./
RUN npm install --no-audit --no-fund \
 && npx -y prisma@6.19.3 generate --schema=./schema.prisma \
 && npx -y esbuild@0.28.2 index.ts --bundle --platform=node --format=cjs \
    --external:nodemailer --external:@prisma/client \
    --outfile=dist/index.js

# ── Engine runtime ──
FROM base AS engine
ENV NODE_ENV=production
WORKDIR /engine
COPY --from=engine-build /engine/node_modules ./node_modules
COPY --from=engine-build /engine/dist ./dist
EXPOSE 3003 3004
CMD ["node", "dist/index.js"]
