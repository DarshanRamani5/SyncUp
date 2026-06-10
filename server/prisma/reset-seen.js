import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * One-Time Cleanup: Reset phantom "unseen" counts
 *
 * Before the mark-read fix, messages sent via Kafka were sometimes not in the
 * DB yet when the recipient's "mark as read" fired, so the seenBy relation was
 * never saved. On restart, getConversations re-counted those as unread, which
 * produced an inflated unread badge (e.g. "45 unseen").
 *
 * This connects ALL participants of each conversation to the seenBy relation
 * of every message — marking the whole backlog as read for everyone.
 *
 * Run once with:  node prisma/reset-seen.js
 * Safe to re-run: connecting an already-seen user is a no-op.
 */
async function main() {
  console.log('🧹 Resetting seen status on existing messages...')

  const conversations = await prisma.conversation.findMany({
    include: {
      users: { select: { userId: true } }
    }
  })

  let updated = 0

  for (const conv of conversations) {
    const participantIds = conv.users.map(u => u.userId)
    if (participantIds.length === 0) continue

    const messages = await prisma.message.findMany({
      where: { conversationId: conv.id },
      select: { id: true }
    })

    for (const msg of messages) {
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          // Connect every participant — already-connected ones are ignored
          seenBy: { connect: participantIds.map(id => ({ id })) }
        }
      }).catch(() => { /* skip any that error */ })
      updated++
    }
  }

  console.log(`✅ Done. Marked ${updated} message(s) as seen by all participants.`)
}

main()
  .catch((e) => {
    console.error('reset-seen error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })