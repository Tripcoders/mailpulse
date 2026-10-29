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
if (process.env.VERCEL && !existsSync(dbPath)) {
  try {
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'pipe',
      timeout: 30000,
    })
  } catch (e: any) {
    console.error('Failed to initialize database schema:', e?.message || e)
  }
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: dbUrl } },
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db