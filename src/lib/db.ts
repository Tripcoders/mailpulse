import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// On Vercel's serverless platform, the filesystem is read-only except /tmp.
const dbUrl = process.env.DATABASE_URL || (process.env.VERCEL ? 'file:/tmp/mailpulse.db' : 'file:./db/custom.db')

// Extract the file path from the DATABASE_URL
const dbPath = dbUrl.replace(/^file:/, '')

// Ensure the directory exists
const dbDir = dirname(dbPath)
if (!existsSync(dbDir)) {
  try {
    mkdirSync(dbDir, { recursive: true })
  } catch (e) {
    console.error('Failed to create db directory:', e)
  }
}

// Initialize the database schema if it doesn't exist
// Try multiple approaches: local prisma binary, then node_modules prisma, then npx
if (process.env.VERCEL && !existsSync(dbPath)) {
  const approaches = [
    () => {
      const prismaBin = `${process.cwd()}/node_modules/.bin/prisma`
      if (!existsSync(prismaBin)) throw new Error('prisma binary not found')
      execSync(`"${prismaBin}" db push --skip-generate --accept-data-loss`, {
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: 'pipe',
        timeout: 60000,
        cwd: process.cwd(),
      })
    },
    () => {
      const prismaJs = `${process.cwd()}/node_modules/prisma/build/index.js`
      if (!existsSync(prismaJs)) throw new Error('prisma build not found')
      execSync(`node "${prismaJs}" db push --skip-generate --accept-data-loss`, {
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: 'pipe',
        timeout: 60000,
        cwd: process.cwd(),
      })
    },
  ]

  let initialized = false
  for (const approach of approaches) {
    try {
      approach()
      initialized = true
      break
    } catch (e: any) {
      console.error('DB init attempt failed:', e?.stderr?.toString() || e?.message || e)
    }
  }

  if (!initialized) {
    console.error('All database initialization approaches failed. Database will not be available.')
  }
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: dbUrl } },
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db