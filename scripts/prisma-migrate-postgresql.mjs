import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const projectRoot = process.cwd()
const schemaPath = resolve(projectRoot, 'prisma/postgresql/schema.prisma')
const baselineSchemaPath = resolve(projectRoot, 'prisma/postgresql/baseline.prisma')
const prismaCliPath = resolve(projectRoot, 'node_modules/prisma/build/index.js')

const commands = {
  dev: ['migrate', 'dev', '--schema', schemaPath],
  deploy: ['migrate', 'deploy', '--schema', schemaPath],
  baseline: ['migrate', 'resolve', '--applied', '0_init', '--schema', schemaPath],
  'check-baseline': [],
}

const mode = process.argv[2]
const args = commands[mode]

if (!args) {
  throw new Error('Usage: prisma-migrate-postgresql.mjs <dev|deploy|baseline|check-baseline>')
}

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(resolve(projectRoot, '.env'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const unpooledUrl = process.env.DATABASE_URL_UNPOOLED

if (!unpooledUrl || !/^postgres(?:ql)?:\/\//i.test(unpooledUrl)) {
  throw new Error('PostgreSQL migrations require DATABASE_URL_UNPOOLED to be configured.')
}

let migrationHost
try {
  migrationHost = new URL(unpooledUrl).hostname
} catch {
  throw new Error('DATABASE_URL_UNPOOLED must be a valid PostgreSQL connection URL.')
}

if (migrationHost.includes('-pooler.')) {
  throw new Error('DATABASE_URL_UNPOOLED must use Neon’s direct endpoint, not its pooler.')
}

if (!existsSync(schemaPath) || !existsSync(prismaCliPath) || !existsSync(baselineSchemaPath)) {
  throw new Error('PostgreSQL schema or local Prisma CLI is missing.')
}

// Prisma Migrate needs a direct Neon connection; keep the pooled URL for app traffic.
const childEnv = { ...process.env, DATABASE_URL: unpooledUrl }
const runPrisma = (prismaArgs) =>
  spawnSync(process.execPath, [prismaCliPath, ...prismaArgs], {
    cwd: projectRoot,
    env: childEnv,
    stdio: 'inherit',
  })

if (mode === 'baseline' || mode === 'check-baseline') {
  const diff = runPrisma([
    'migrate',
    'diff',
    '--from-schema-datasource',
    schemaPath,
    '--to-schema-datamodel',
    baselineSchemaPath,
    '--exit-code',
  ])

  if (diff.error) throw diff.error
  if (diff.status === 2) {
    throw new Error(
      'The connected Neon database does not match the pre-workspace PostgreSQL baseline; no migration state was changed.',
    )
  }
  if (diff.status !== 0) {
    throw new Error('Could not inspect the connected PostgreSQL schema; no migration state was changed.')
  }
  if (mode === 'check-baseline') {
    console.log('The connected PostgreSQL database matches the pre-workspace baseline. No database state was changed.')
    process.exit(0)
  }
}

const result = runPrisma(args)

if (result.error) throw result.error
process.exitCode = result.status ?? 1
