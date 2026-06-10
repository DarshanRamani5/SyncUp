import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

/**
 * Seed Script
 * 
 * Creates 3 demo users and a sample conversation with messages.
 * Run with: npx prisma db seed
 * 
 * Demo accounts:
 *   alice@test.com   / password123
 *   bob@test.com     / password123
 *   charlie@test.com / password123
 */
async function main() {
  console.log('🌱 Seeding database...')

  // Hash the demo password
  const salt = await bcrypt.genSalt(10)
  const passwordHash = await bcrypt.hash('password123', salt)

  // --- Create demo users ---
  const alice = await prisma.user.upsert({
    where: { email: 'alice@test.com' },
    update: {},
    create: {
      name: 'Alice Johnson',
      email: 'alice@test.com',
      passwordHash,
      color: '#6366f1'
    }
  })

  const bob = await prisma.user.upsert({
    where: { email: 'bob@test.com' },
    update: {},
    create: {
      name: 'Bob Smith',
      email: 'bob@test.com',
      passwordHash,
      color: '#8b5cf6'
    }
  })

  const charlie = await prisma.user.upsert({
    where: { email: 'charlie@test.com' },
    update: {},
    create: {
      name: 'Charlie Davis',
      email: 'charlie@test.com',
      passwordHash,
      color: '#ec4899'
    }
  })

  console.log('✅ Created users:', { alice: alice.id, bob: bob.id, charlie: charlie.id })

  // --- Create a sample conversation between Alice and Bob ---
  // Uses ConversationsOnUsers join table (composite key: userId + conversationId)
  const conversation = await prisma.conversation.create({
    data: {
      isGroup: false,
      users: {
        create: [
          { userId: alice.id },
          { userId: bob.id }
        ]
      }
    }
  })

  console.log('✅ Created conversation:', conversation.id)

  // --- Add some sample messages ---
  // In the new schema, senderId is now `userId` and relation is `createdBy`
  await prisma.message.createMany({
    data: [
      {
        conversationId: conversation.id,
        userId: alice.id,
        body: 'Hey Bob! Welcome to SyncUp 👋',
        createdAt: new Date('2024-01-01T10:00:00Z')
      },
      {
        conversationId: conversation.id,
        userId: bob.id,
        body: 'Hey Alice! This looks great! 🎉',
        createdAt: new Date('2024-01-01T10:01:00Z')
      },
      {
        conversationId: conversation.id,
        userId: alice.id,
        body: 'Right? Real-time messaging is coming next!',
        createdAt: new Date('2024-01-01T10:02:00Z')
      }
    ]
  })

  // Update conversation's lastMessageAt
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date('2024-01-01T10:02:00Z') }
  })

  console.log('✅ Created sample messages')
  console.log('')
  console.log('📧 Demo accounts:')
  console.log('   alice@test.com   / password123')
  console.log('   bob@test.com     / password123')
  console.log('   charlie@test.com / password123')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Seed error:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
