import type { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { issueDueBills, serializable } from './billing.js'
import { gymToday, moveDays } from './billing-dates.js'

const keyDate = (date: Date) => date.toISOString().slice(0, 10)
const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100)

export function reminderDays(value = process.env.REMINDER_DAYS ?? '3') {
  if (!/^(?:[1-9]|[12][0-9]|30)$/.test(value)) throw new Error('REMINDER_DAYS must be from 1 to 30.')
  return Number(value)
}

async function createReminders(database: PrismaClient, today: Date, days: number) {
  const next = moveDays(today, days)
  const dateKey = keyDate(today)
  const where = { status: 'OPEN' as const, membership: { member: { archivedAt: null } } }
  let after: string | undefined
  let created = 0

  for (;;) {
    const bills = await database.bill.findMany({
      where: { ...where, dueDate: { in: [today, next] }, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' }, take: 100,
      select: { id: true },
    })
    if (!bills.length) break
    created += await serializable(database, async (transaction) => {
      const current = await transaction.bill.findMany({
        where: { ...where, id: { in: bills.map(({ id }) => id) } },
        select: {
          id: true, membershipId: true, dueDate: true, amountPaise: true, planName: true,
          membership: { select: { member: { select: { userId: true, user: { select: { active: true } } } } } },
          payments: { select: { amountPaise: true } },
        },
      })
      const rows: Prisma.NotificationCreateManyInput[] = []
      for (const bill of current) {
        if (!bill.membership.member.user.active) continue
        const balance = bill.amountPaise - bill.payments.reduce((total, payment) => total + payment.amountPaise, 0)
        if (balance <= 0) continue
        const due = keyDate(bill.dueDate)
        if (due !== dateKey && due !== keyDate(next)) continue
        const kind = due === dateKey ? 'DUE_TODAY' : 'DUE_SOON'
        const recipientId = bill.membership.member.userId
        rows.push({
          recipientId, billId: bill.id, kind,
          message: bill.planName + ' fee of ' + money(balance) +
            (kind === 'DUE_TODAY' ? ' is due today.' : ' is due on ' + due + '.'),
          deduplicationKey: kind + ':' + recipientId + ':' + bill.membershipId + ':' + due,
        })
      }
      return rows.length ? (await transaction.notification.createMany({ data: rows, skipDuplicates: true })).count : 0
    }, true)
    after = bills.at(-1)!.id
  }

  // Upcoming renewal charges are issued on their due date. Remind members from
  // the schedule when the bill does not exist yet, using the same deduplication key.
  after = undefined
  for (;;) {
    const dueWhere = { nextBillingDate: next, endsOn: null, member: { archivedAt: null, user: { active: true } } }
    const memberships: { id: string }[] = await database.membership.findMany({
      where: { ...dueWhere, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' }, take: 100, select: { id: true },
    })
    if (!memberships.length) break
    created += await serializable(database, async (transaction) => {
      const current = await transaction.membership.findMany({
        where: { ...dueWhere, id: { in: memberships.map(({ id }) => id) }, bills: { none: { periodStart: next } } },
        select: { id: true, currentPlan: true, pendingPlan: true, member: { select: { userId: true } } },
      })
      const due = keyDate(next)
      if (!current.length) return 0
      return (await transaction.notification.createMany({
        skipDuplicates: true, data: current.map((membership) => {
          const plan = membership.pendingPlan ?? membership.currentPlan
          const recipientId = membership.member.userId
          return {
            recipientId, kind: 'DUE_SOON', deduplicationKey: 'DUE_SOON:' + recipientId + ':' + membership.id + ':' + due,
            message: plan.name + ' fee of ' + money(plan.amountPaise) + ' is due on ' + due + '.',
          }
        }),
      })).count
    }, true)
    after = memberships.at(-1)!.id
  }

  created += await serializable(database, async (transaction) => {
    const dueWhere = { ...where, dueDate: today }
    const total = await transaction.bill.count({ where: dueWhere })
    if (!total) return 0
    const admins = await transaction.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true } })
    if (!admins.length) return 0
    const samples = await transaction.bill.findMany({
      where: dueWhere, orderBy: { id: 'asc' }, take: 10,
      select: { membership: { select: { member: { select: { fullName: true } } } } },
    })
    const memberList = samples.map((bill) => bill.membership.member.fullName).join(', ')
    const extra = total > samples.length ? ' and ' + (total - samples.length) + ' more' : ''
    const message = total + (total === 1 ? ' bill is' : ' bills are') +
      ' due today for ' + memberList + extra + '. Open the overview for the full due list.'
    return (await transaction.notification.createMany({
      skipDuplicates: true,
      data: admins.map(({ id }) => ({
        recipientId: id, kind: 'ADMIN_DUE_DIGEST', message,
        deduplicationKey: 'ADMIN_DUE_DIGEST:' + id + ':' + dateKey,
      })),
    })).count
  }, true)
  return created
}

export async function runReminderJob(database: PrismaClient, now = new Date(), days = reminderDays()) {
  const today = gymToday(now)
  const job = await database.jobRun.create({ data: { name: 'daily-reminders', businessDate: today } })
  try {
    const billing = await issueDueBills(database, now)
    const notifications = await createReminders(database, today, days)
    const summary = { ...billing, notifications }
    await database.jobRun.update({
      where: { id: job.id }, data: { finishedAt: new Date(), succeeded: true, summary },
    })
    return summary
  } catch (error) {
    await database.jobRun.update({
      where: { id: job.id }, data: { finishedAt: new Date(), succeeded: false },
    }).catch(() => console.error('Could not save a reminder job failure.'))
    throw error
  }
}
