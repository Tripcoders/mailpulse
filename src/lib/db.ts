import { PrismaClient } from '@prisma/client'
import { currentWorkspaceContext } from '@/lib/workspace-store'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  scopedPrisma: any
}

const databaseUrl = process.env.DATABASE_URL?.trim()
const isPostgres = databaseUrl?.startsWith('postgresql://') || databaseUrl?.startsWith('postgres://')

if (process.env.VERCEL && !isPostgres) {
  throw new Error('DATABASE_URL must point to Neon PostgreSQL for Vercel deployments.')
}

if (databaseUrl && !isPostgres) {
  throw new Error('MailPulse now uses Neon PostgreSQL; DATABASE_URL must be a PostgreSQL connection string.')
}

const baseDb =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
    log: ['error', 'warn'],
  })

const tenantModels = new Set([
  'EmailSession',
  'EmailRecipient',
  'Attachment',
  'Signature',
  'EmailTemplate',
  'SendLog',
  'CampaignSmtpCredential',
  'Setting',
  'SmtpProfile',
  'WizardDraft',
])

const writeOperations = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'delete',
  'deleteMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
])

function scopeData(data: any, workspaceId: string, includeCampaignChildren = false): any {
  if (Array.isArray(data)) {
    return data.map((item) => scopeData(item, workspaceId, includeCampaignChildren))
  }
  if (!data || typeof data !== 'object') return data

  const scoped = { ...data, workspaceId }
  if (includeCampaignChildren) {
    for (const relation of ['recipients', 'attachments', 'logs']) {
      const nested = scoped[relation]
      if (!nested || typeof nested !== 'object') continue

      const nestedScoped = { ...nested }
      if ('create' in nestedScoped) {
        nestedScoped.create = scopeData(nestedScoped.create, workspaceId)
      }
      if ('createMany' in nestedScoped) {
        const createMany = nestedScoped.createMany
        if (createMany && typeof createMany === 'object' && 'data' in createMany) {
          nestedScoped.createMany = {
            ...createMany,
            data: scopeData(createMany.data, workspaceId),
          }
        }
      }
      scoped[relation] = nestedScoped
    }
  }
  return scoped
}

function withWorkspaceWhere(args: Record<string, any>, workspaceId: string) {
  args.where = { ...(args.where || {}), workspaceId }
}

const scopedDb =
  globalForPrisma.scopedPrisma ??
  baseDb.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !tenantModels.has(model)) return query(args)

          const context = currentWorkspaceContext()
          if (context.role === 'viewer' && writeOperations.has(operation)) {
            throw new Error('This workspace role is read-only.')
          }

          const workspaceId = context.workspaceId
          const scopedArgs = { ...(args as Record<string, any>) }

          if (
            operation === 'findUnique' ||
            operation === 'findUniqueOrThrow' ||
            operation === 'findFirst' ||
            operation === 'findFirstOrThrow' ||
            operation === 'findMany' ||
            operation === 'count' ||
            operation === 'aggregate' ||
            operation === 'groupBy' ||
            operation === 'update' ||
            operation === 'updateMany' ||
            operation === 'updateManyAndReturn' ||
            operation === 'delete' ||
            operation === 'deleteMany' ||
            operation === 'upsert'
          ) {
            withWorkspaceWhere(scopedArgs, workspaceId)
          }

          if (operation === 'create') {
            scopedArgs.data = scopeData(scopedArgs.data, workspaceId, model === 'EmailSession')
          } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
            scopedArgs.data = scopeData(scopedArgs.data, workspaceId)
          } else if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') {
            scopedArgs.data = scopeData(scopedArgs.data, workspaceId)
          } else if (operation === 'upsert') {
            scopedArgs.create = scopeData(scopedArgs.create, workspaceId, model === 'EmailSession')
            scopedArgs.update = scopeData(scopedArgs.update, workspaceId)
          }

          return query(scopedArgs as typeof args)
        },
      },
    },
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = baseDb
  globalForPrisma.scopedPrisma = scopedDb
}

export const db = scopedDb
