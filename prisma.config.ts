import { defineConfig } from 'prisma/config'

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export default defineConfig({
  schema: 'prisma/postgresql/schema.prisma',
  migrations: {
    path: 'prisma/postgresql/migrations',
  },
})
