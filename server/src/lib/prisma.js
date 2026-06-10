import { PrismaClient } from '@prisma/client'

// Singleton pattern to avoid multiple Prisma Client instances in development
// (nodemon restarts create new instances, exhausting DB connections)

const globalForPrisma = globalThis

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
