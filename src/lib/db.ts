import { PrismaClient } from '@prisma/client'
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { dirname, join } from 'path'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Determine database URL based on environment
const isPostgres = process.env.DATABASE_URL?.startsWith('postgresql://') || process.env.DATABASE_URL?.startsWith('postgres://')
const isVercel = !!process.env.VERCEL

let dbUrl: string
if (isPostgres) {
  // Cloud database (PostgreSQL) - use as-is
  dbUrl = process.env.DATABASE_URL!
} else if (isVercel) {
  // Vercel with SQLite - use /tmp
  dbUrl = process.env.DATABASE_URL || 'file:/tmp/mailpulse.db'
} else {
  // Local development - use local file
  dbUrl = process.env.DATABASE_URL || 'file:./db/custom.db'
}

// Only handle file-based databases (SQLite)
const isFileDb = dbUrl.startsWith('file:')
if (isFileDb) {
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
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: dbUrl } },
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db