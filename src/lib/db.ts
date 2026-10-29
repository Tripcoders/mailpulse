import { PrismaClient } from '@prisma/client'
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { dirname, join } from 'path'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// On Vercel's serverless platform, the filesystem is read-only except /tmp.
const isVercel = !!process.env.VERCEL
const dbUrl = process.env.DATABASE_URL || (isVercel ? 'file:/tmp/mailpulse.db' : 'file:./db/custom.db')

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

// On Vercel, copy the bundled database (with schema) to /tmp if it doesn't exist
if (isVercel && !existsSync(dbPath)) {
  const bundledDb = join(process.cwd(), 'db', 'deploy.db')
  if (existsSync(bundledDb)) {
    try {
      copyFileSync(bundledDb, dbPath)
      console.log('Copied bundled database to /tmp')
    } catch (e: any) {
      console.error('Failed to copy bundled database:', e?.message || e)
    }
  } else {
    console.error('Bundled database not found at:', bundledDb)
  }
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: dbUrl } },
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db