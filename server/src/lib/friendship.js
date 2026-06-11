import prisma from './prisma.js'

/**
 * areFriends(a, b)
 *
 * Shared helper: are these two users currently friends?
 * Used by the socket layer, message controller, and conversation controller
 * to enforce "friends-only" messaging.
 *
 * We connect the Friends relation both ways on accept, but check both
 * directions anyway to be safe against any one-sided legacy data.
 */
export const areFriends = async (userIdA, userIdB) => {
  if (!userIdA || !userIdB) return false
  const user = await prisma.user.findFirst({
    where: {
      id: userIdA,
      OR: [
        { friendsWith: { some: { id: userIdB } } },
        { friendOf: { some: { id: userIdB } } }
      ]
    },
    select: { id: true }
  })
  return !!user
}

export default areFriends