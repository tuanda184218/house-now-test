import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { authGuard } from '@/server/trpc/middlewares/auth-guard'
import { procedure } from '@/server/trpc/procedures'
import { router } from '@/server/trpc/router'
import { IdSchema } from '@/utils/server/base-schemas'
import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'

const SendFriendshipRequestInputSchema = z.object({
  friendUserId: IdSchema,
})

const canSendFriendshipRequest = authGuard.unstable_pipe(
  async ({ ctx, rawInput, next }) => {
    const { friendUserId } = SendFriendshipRequestInputSchema.parse(rawInput)

    await ctx.db
      .selectFrom('users')
      .where('users.id', '=', friendUserId)
      .select('id')
      .limit(1)
      .executeTakeFirstOrThrow(
        () =>
          new TRPCError({
            code: 'BAD_REQUEST',
          })
      )

    return next({ ctx })
  }
)

const AnswerFriendshipRequestInputSchema = z.object({
  friendUserId: IdSchema,
})

const canAnswerFriendshipRequest = authGuard.unstable_pipe(
  async ({ ctx, rawInput, next }) => {
    const { friendUserId } = AnswerFriendshipRequestInputSchema.parse(rawInput)

    await ctx.db
      .selectFrom('friendships')
      .where('friendships.userId', '=', friendUserId)
      .where('friendships.friendUserId', '=', ctx.session.userId)
      .where(
        'friendships.status',
        '=',
        FriendshipStatusSchema.Values['requested']
      )
      .select('friendships.id')
      .limit(1)
      .executeTakeFirstOrThrow(() => {
        throw new TRPCError({
          code: 'BAD_REQUEST',
        })
      })

    return next({ ctx })
  }
)

export const friendshipRequestRouter = router({
  send: procedure
    .use(canSendFriendshipRequest)
    .input(SendFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction().execute(async (t) => {
        // check a friendship request exists
        const existingFriendship = await t
          .selectFrom('friendships')
          .selectAll()
          .where('friendships.userId', '=', ctx.session.userId)
          .where('friendships.friendUserId', '=', input.friendUserId)
          .executeTakeFirst()

        if (existingFriendship) {
          // if friendship status is declined, update to 'requested'
          if (
            existingFriendship.status ===
            FriendshipStatusSchema.Values['declined']
          ) {
            await t
              .updateTable('friendships')
              .set({
                status: FriendshipStatusSchema.Values['requested'],
              })
              .where('id', '=', existingFriendship.id)
              .execute()
          } else {
            // other status, throw error
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'A friendship request is already in progress or has been accepted.',
            })
          }
        } else {
          // if no exists, create new
          await t
            .insertInto('friendships')
            .values({
              userId: ctx.session.userId,
              friendUserId: input.friendUserId,
              status: FriendshipStatusSchema.Values['requested'],
            })
            .execute()
        }
      })

      return { message: 'Friendship request sent successfully' }
    }),

  accept: procedure
    .use(canAnswerFriendshipRequest)
    .input(AnswerFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction().execute(async (t) => {
        // update the friendship request to have status `accepted`
        await t
          .updateTable('friendships')
          .set({
            status: FriendshipStatusSchema.Values['accepted'],
          })
          .where('friendships.userId', '=', input.friendUserId)
          .where('friendships.friendUserId', '=', ctx.session.userId)
          .execute()

        // check reverse friendship already exists
        const existingFriendship = await t
          .selectFrom('friendships')
          .select('id')
          .where('friendships.userId', '=', ctx.session.userId)
          .where('friendships.friendUserId', '=', input.friendUserId)
          .executeTakeFirst()

        if (!existingFriendship) {
          // create a new friendship record
          await t
            .insertInto('friendships')
            .values({
              userId: ctx.session.userId,
              friendUserId: input.friendUserId,
              status: FriendshipStatusSchema.Values['accepted'],
            })
            .execute()
        } else {
          // if exists, update status to `accepted`
          await t
            .updateTable('friendships')
            .set({
              status: FriendshipStatusSchema.Values['accepted'],
            })
            .where('friendships.userId', '=', ctx.session.userId)
            .where('friendships.friendUserId', '=', input.friendUserId)
            .execute()
        }

        return { message: 'Friendship accepted successfully' }
      })
    }),

  decline: procedure
    .use(canAnswerFriendshipRequest)
    .input(AnswerFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction().execute(async (t) => {
        await t
          .updateTable('friendships')
          .set({
            status: FriendshipStatusSchema.Values['declined'],
          })
          .where('friendships.userId', '=', input.friendUserId)
          .where('friendships.friendUserId', '=', ctx.session.userId)
          .execute()
      })

      return { message: 'Friendship request declined successfully' }
    }),
})
