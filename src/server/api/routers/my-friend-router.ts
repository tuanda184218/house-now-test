import type { Database } from '@/server/db'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { protectedProcedure } from '@/server/trpc/procedures'
import { router } from '@/server/trpc/router'
import { IdSchema } from '@/utils/server/base-schemas'
import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'

// function calculate the mutual friend
const userMutualFriendCount = (
  db: Database,
  userId: number,
  friendUserId: number
) => {
  return db
    .selectFrom('friendships as f1')
    .innerJoin('friendships as f2', 'f1.friendUserId', 'f2.friendUserId')
    .where('f1.userId', '=', userId)
    .where('f2.userId', '=', friendUserId)
    .where('f1.status', '=', FriendshipStatusSchema.Values['accepted'])
    .where('f2.status', '=', FriendshipStatusSchema.Values['accepted'])
    .select((eb) => eb.fn.count('f1.friendUserId').as('mutualFriendCount'))
    .executeTakeFirstOrThrow()
}

export const myFriendRouter = router({
  getById: protectedProcedure
    .input(
      z.object({
        friendUserId: IdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.connection().execute(async (conn) => {
        const [friendInfo, mutualFriendCount] = await Promise.all([
          conn
            .selectFrom('users as friends')
            .innerJoin('friendships', 'friendships.friendUserId', 'friends.id')
            .innerJoin(
              userTotalFriendCount(conn).as('userTotalFriendCount'),
              'userTotalFriendCount.userId',
              'friends.id'
            )
            .where('friendships.userId', '=', ctx.session.userId)
            .where('friendships.friendUserId', '=', input.friendUserId)
            .where(
              'friendships.status',
              '=',
              FriendshipStatusSchema.Values['accepted']
            )
            .select([
              'friends.id',
              'friends.fullName',
              'friends.phoneNumber',
              'totalFriendCount',
            ])
            .executeTakeFirstOrThrow(
              () => new TRPCError({ code: 'NOT_FOUND' })
            ),
          userMutualFriendCount(conn, ctx.session.userId, input.friendUserId),
        ])

        return {
          ...friendInfo,
          mutualFriendCount: mutualFriendCount.mutualFriendCount,
        }
      })
    }),
})

const userTotalFriendCount = (db: Database) => {
  return db
    .selectFrom('friendships')
    .where('friendships.status', '=', FriendshipStatusSchema.Values['accepted'])
    .select((eb) => [
      'friendships.userId',
      eb.fn.count('friendships.friendUserId').as('totalFriendCount'),
    ])
    .groupBy('friendships.userId')
}
