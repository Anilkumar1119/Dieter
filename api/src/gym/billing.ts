import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { billingRenewal, gymToday } from './billing-dates.js'

export async function serializable<T>(
  database: PrismaClient, run: (transaction: Prisma.TransactionClient) => Promise<T>,
  uniqueRetry = false,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await database.$transaction(run, { isolationLevel: 'Serializable' })
    } catch (error) {
      const retry = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || (uniqueRetry && error.code === 'P2002'))
      if (!retry || attempt >= 4) throw error
    }
  }
}

export async function issueDueBills(database: PrismaClient, now = new Date()) {
  const today = gymToday(now)
  let after: string | undefined
  let memberships = 0
  let bills = 0
  for (;;) {
    const batch: { id: string }[] = await database.membership.findMany({
      where: {
        nextBillingDate: { lte: today },
        endsOn: null,
        member: { archivedAt: null },
        ...(after ? { id: { gt: after } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
    })
    if (!batch.length) return { memberships, bills }
    for (const { id } of batch) {
      const outcome = await serializable(database, async (transaction) => {
        const membership = await transaction.membership.findFirst({
          where: { id, endsOn: null, member: { archivedAt: null }, nextBillingDate: { lte: today } },
          include: { currentPlan: true, pendingPlan: true },
        })
        if (!membership) return null

        const plan = membership.pendingPlan ?? membership.currentPlan
        const rows: Prisma.BillCreateManyInput[] = []
        let start = membership.nextBillingDate
        while (start <= today) {
          const end = billingRenewal(start, plan.intervalMonths, membership.cycleAnchorDate.getUTCDate())
          rows.push({
            membershipId: id, periodStart: start, periodEnd: end, dueDate: start,
            amountPaise: plan.amountPaise, planName: plan.name, planIntervalMonths: plan.intervalMonths,
          })
          start = end
        }
        const inserted = await transaction.bill.createMany({ data: rows, skipDuplicates: true })
        await transaction.membership.update({
          where: { id },
          data: { nextBillingDate: start, currentPlanId: plan.id, pendingPlanId: null },
        })
        return inserted.count
      }, true)
      if (outcome !== null) {
        memberships++
        bills += outcome
      }
    }
    after = batch[batch.length - 1].id
  }
}
