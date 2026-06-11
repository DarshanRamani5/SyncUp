import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Backfill Usernames
 *
 * One-time script for accounts created BEFORE the username system existed.
 * The schema keeps username nullable so the migration succeeds, but old
 * accounts can't be found in friend search until they have one.
 *
 * Strategy: derive a username from the email prefix
 *   "alice@test.com" → "alice"
 * If that's taken, append a number: "alice1", "alice2", ...
 *
 * Run once after migrating:
 *   node prisma/backfill-usernames.js
 */
async function main() {
  const usersWithoutUsername = await prisma.user.findMany({
    where: { username: null },
    select: { id: true, email: true, name: true }
  })

  console.log(`Found ${usersWithoutUsername.length} user(s) without a username`)

  for (const user of usersWithoutUsername) {
    // Sanitize the email prefix into a valid username
    let base = user.email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 18)

    // Enforce minimum length of 3
    if (base.length < 3) base = `user_${base}`

    // Find a free variant: base, base1, base2, ...
    let candidate = base
    let counter = 1
    while (await prisma.user.findUnique({ where: { username: candidate } })) {
      candidate = `${base}${counter}`
      counter++
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { username: candidate }
    })

    console.log(`  ✅ ${user.email} → @${candidate}`)
  }

  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())