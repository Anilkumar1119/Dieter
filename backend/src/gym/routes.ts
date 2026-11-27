import express, { type RequestHandler } from 'express'
import { z } from 'zod'
import { type createAuth, memberEmail, phone, protectAccountRequests } from '../auth/routes.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { billingRenewal, gymToday, moveDays } from './billing-dates.js'
import { mountNotificationRoutes } from './notification-routes.js'
import { mountBillingRoutes } from './payment-routes.js'

const planInput = z.object({
  name: z.string().trim().min(1).max(80),
  amountPaise: z.number().int().positive().max(2147483647),
  intervalMonths: z.union([z.literal(1), z.literal(3), z.literal(12)]),
  active: z.boolean().default(true),
})
const memberInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  age: z.number().int().min(1).max(130),
  phone,
  email: z.union([memberEmail, z.literal(''), z.null()]).transform((value) => value || null),
  admissionDate: z.iso.date().refine((value) => value >= '1900-01-01' && value <= '9998-12-31'),
  planId: z.uuid(),
})
const pageNumber = z.coerce.number().int().min(1).max(100_000).default(1)
const historyPageSize = 25
const listInput = z.object({
  q: z.string().trim().max(120).default(''),
  page: pageNumber,
  sort: z.enum(['name', 'admission', 'phone']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  status: z.enum(['current', 'archived', 'all']).default('current'),
})
const planFields = {
  id: true, name: true, amountPaise: true, intervalMonths: true, active: true,
} satisfies Prisma.FeePlanSelect
const cardFields = {
  id: true, fullName: true, age: true, email: true, loginEmail: true, admissionDate: true, archivedAt: true,
  user: { select: { phone: true, active: true, accountActivatedAt: true } },
  membership: { select: { nextBillingDate: true, endsOn: true, currentPlan: { select: planFields }, pendingPlan: { select: planFields } } },
} satisfies Prisma.MemberSelect
const billFields = {
  id: true, periodStart: true, periodEnd: true, dueDate: true, amountPaise: true, planName: true, status: true,
  payments: {
    orderBy: { receivedAt: 'desc' },
    select: { id: true, amountPaise: true, method: true, receivedAt: true, receiptNumber: true },
  },
} satisfies Prisma.BillSelect

class Conflict extends Error {}
const fail = (response: express.Response, message = 'Check the submitted fields and try again.') =>
  response.status(400).json({ error: message })

function write(handler: RequestHandler): RequestHandler {
  return async (request, response, next) => {
    try { await handler(request, response, next) }
    catch (error) {
      if (error instanceof Conflict) { response.status(409).json({ error: error.message }); return }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') { response.status(409).json({ error: 'That phone number, email address, or fee plan name is already in use.' }); return }
        if (error.code === 'P2025') { response.status(404).json({ error: 'This record no longer exists.' }); return }
        if (error.code === 'P2034' || error.code === 'P2003') {
          response.status(409).json({ error: 'This record changed during your request. Refresh and try again.' }); return
        }
      }
      next(error)
    }
  }
}

async function claimedEmail(transaction: Prisma.TransactionClient, email: string, memberId?: string) {
  return transaction.member.findFirst({
    where: { OR: [{ loginEmail: email }, { email: { equals: email, mode: 'insensitive' } }],
      ...(memberId ? { id: { not: memberId } } : {}) },
    select: { id: true },
  })
}

async function logChange(transaction: Prisma.TransactionClient, actorId: string, action: string, entityType: string, entityId: string) {
  await transaction.auditLog.create({ data: { actorId, action, entityType, entityId } })
}

function period(start: Date, months: number) {
  return billingRenewal(start, months, start.getUTCDate())
}

async function initializeMembership(
  tx: Prisma.TransactionClient, memberId: string, start: Date,
  plan: { id: string; name: string; amountPaise: number; intervalMonths: number },
) {
  const admitted = start <= gymToday()
  const renewal = period(start, plan.intervalMonths)
  await tx.membership.create({
    data: {
      memberId, currentPlanId: plan.id, cycleAnchorDate: start, nextBillingDate: admitted ? renewal : start,
      ...(admitted ? { bills: { create: {
        periodStart: start, periodEnd: renewal, dueDate: start, amountPaise: plan.amountPaise,
        planName: plan.name, planIntervalMonths: plan.intervalMonths,
      } } } : {}),
    },
  })
}

async function billHistory(database: PrismaClient, where: Prisma.BillWhereInput, page: number) {
  const [bills, total] = await Promise.all([
    database.bill.findMany({
      where, orderBy: [{ dueDate: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * historyPageSize, take: historyPageSize, select: billFields,
    }),
    database.bill.count({ where }),
  ])
  return { bills, billPage: page, billPages: Math.max(1, Math.ceil(total / historyPageSize)), totalBills: total }
}

export function createGymRoutes(database: PrismaClient, auth: ReturnType<typeof createAuth>, origin: string) {
  const admin = express.Router()
  const member = express.Router()
  admin.use(protectAccountRequests(origin), express.json({ limit: '12kb' }), auth.requireSession, auth.requireRole('ADMIN'))
  member.use(protectAccountRequests(origin), auth.requireSession, auth.requireRole('MEMBER'))

  admin.get('/dashboard', async (request, response) => {
    const page = pageNumber.safeParse(request.query.duePage)
    if (!page.success) { fail(response); return }
    const today = gymToday()
    const upcomingEnd = moveDays(today, 7)
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))
    const indiaOffset = 330 * 60_000
    const open = { status: 'OPEN' } as const
    const dueWhere = { ...open, dueDate: { lte: today } }
    const [totalMembers, pendingBills, paidMemberships, upcomingBills, renewals, due, totalDue] = await Promise.all([
      database.member.count({ where: { archivedAt: null } }),
      database.bill.count({ where: open }),
      database.bill.findMany({
        where: { payments: { some: { receivedAt: {
          gte: new Date(monthStart.getTime() - indiaOffset), lt: new Date(nextMonth.getTime() - indiaOffset),
        } } } },
        distinct: ['membershipId'], select: { membershipId: true },
      }),
      database.bill.findMany({ where: { ...open, dueDate: { gt: today, lte: upcomingEnd } }, distinct: ['membershipId'], select: { membershipId: true } }),
      database.membership.findMany({ where: { endsOn: null, nextBillingDate: { gt: today, lte: upcomingEnd } }, select: { id: true } }),
      database.bill.findMany({
        where: dueWhere,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        skip: (page.data - 1) * historyPageSize, take: historyPageSize,
        select: { ...billFields, membership: { select: { member: { select: { id: true, fullName: true } } } } },
      }),
      database.bill.count({ where: dueWhere }),
    ])
    response.json({ today, totalMembers, pendingBills, paidThisMonth: paidMemberships.length,
      upcomingDues: new Set([...upcomingBills.map((bill) => bill.membershipId), ...renewals.map((renewal) => renewal.id)]).size,
      due, duePage: page.data, duePages: Math.max(1, Math.ceil(totalDue / historyPageSize)), totalDue })
  })

  admin.get('/members', async (request, response) => {
    const input = listInput.safeParse(request.query)
    if (!input.success) { fail(response); return }
    const { q, page, sort, order, status } = input.data
    const where: Prisma.MemberWhereInput = {
      ...(status === 'all' ? {} : { archivedAt: status === 'current' ? null : { not: null } }),
      ...(q ? { OR: [
        { fullName: { contains: q, mode: 'insensitive' } },
        { user: { phone: { contains: q.replace(/[\s()-]/g, '') || q } } },
      ] } : {}),
    }
    const ordering: Record<typeof sort, Prisma.MemberOrderByWithRelationInput> = {
      name: { fullName: order }, admission: { admissionDate: order }, phone: { user: { phone: order } },
    }
    const size = 15
    const [records, total] = await Promise.all([
      database.member.findMany({ where, orderBy: [ordering[sort], { id: 'asc' }], skip: (page - 1) * size, take: size, select: cardFields }),
      database.member.count({ where }),
    ])
    response.json({ records, total, page, pages: Math.max(1, Math.ceil(total / size)) })
  })

  admin.get('/members/:id', async (request, response) => {
    if (!z.uuid().safeParse(request.params.id).success) { fail(response); return }
    const profile = await database.member.findUnique({ where: { id: request.params.id }, select: cardFields })
    if (!profile) { response.status(404).json({ error: 'Member not found.' }); return }
    const page = pageNumber.safeParse(request.query.billPage)
    if (!page.success) { fail(response); return }
    response.json({ profile, ...await billHistory(database, { membership: { memberId: profile.id } }, page.data) })
  })

  admin.post('/members', write(async (request, response) => {
    const input = memberInput.safeParse(request.body)
    if (!input.success) { fail(response); return }
    const { phone: number, planId, admissionDate, ...profile } = input.data
    const record = await database.$transaction(async (tx) => {
      const plan = await tx.feePlan.findFirst({ where: { id: planId, active: true }, select: planFields })
      if (!plan) throw new Conflict('Choose an active fee plan.')
      const user = await tx.user.upsert({ where: { phone: number }, create: { phone: number, role: 'MEMBER' }, update: {},
        select: { id: true, role: true, active: true, member: { select: { id: true } } } })
      if (user.role !== 'MEMBER' || !user.active || user.member) throw new Conflict('That mobile number is already assigned.')
      if (profile.email && await claimedEmail(tx, profile.email)) throw new Conflict('That email address is already assigned to another member.')
      const admitted = new Date(admissionDate)
      const created = await tx.member.create({
        data: { ...profile, loginEmail: profile.email, userId: user.id, admissionDate: admitted },
      })
      await initializeMembership(tx, created.id, admitted, plan)
      await logChange(tx, response.locals.account.id, 'MEMBER_CREATED', 'Member', created.id)
      return created
    }, { isolationLevel: 'Serializable' })
    response.status(201).json({ id: record.id })
  }))

  admin.patch('/members/:id', write(async (request, response) => {
    const input = memberInput.safeParse(request.body)
    const id = z.uuid().safeParse(request.params.id)
    if (!input.success || !id.success) { fail(response); return }
    const { phone: number, planId, admissionDate, ...profile } = input.data
    await database.$transaction(async (tx) => {
      const record = await tx.member.findUniqueOrThrow({ where: { id: id.data }, include: {
        user: { select: { phone: true } }, membership: { include: { _count: { select: { bills: true } } } },
      } })
      if (record.archivedAt) throw new Conflict('Archived members cannot be edited.')
      const membership = record.membership
      const start = new Date(admissionDate)
      const changedStart = start.getTime() !== record.admissionDate.getTime()
      if (changedStart && membership?._count.bills) throw new Conflict('Admission dates cannot be changed after a bill is issued.')
      const existingPlan = planId === membership?.currentPlanId || planId === membership?.pendingPlanId
      const plan = await tx.feePlan.findFirst({ where: { id: planId, ...(existingPlan ? {} : { active: true }) }, select: planFields })
      if (!plan) throw new Conflict('Choose an active fee plan.')
      let loginEmail = profile.email
      if (loginEmail && await claimedEmail(tx, loginEmail, record.id)) {
        if (record.loginEmail || loginEmail !== record.email?.trim().toLowerCase()) {
          throw new Conflict('That email address is already assigned to another member.')
        }
        loginEmail = null
      }

      const phoneChanged = number !== record.user.phone
      const emailChanged = loginEmail !== record.loginEmail
      if (phoneChanged || emailChanged) {
        // Lock the user first, in the same order as code verification.
        await tx.user.update({
          where: { id: record.userId },
          data: { phone: number, ...(emailChanged ? { accountActivatedAt: null } : {}) },
        })
      }
      if (emailChanged) {
        await tx.accountChallenge.deleteMany({ where: { userId: record.userId } })
        await tx.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } })
      }
      await tx.member.update({ where: { id: record.id }, data: { ...profile, loginEmail, admissionDate: start } })
      if (!membership || !membership._count.bills) {
        if (membership) await tx.membership.delete({ where: { id: membership.id } })
        await initializeMembership(tx, record.id, start, plan)
      } else {
        await tx.membership.update({ where: { id: membership.id },
          data: { pendingPlanId: plan.id === membership.currentPlanId ? null : plan.id } })
      }
      await logChange(tx, response.locals.account.id, 'MEMBER_UPDATED', 'Member', record.id)
    }, { isolationLevel: 'Serializable' })
    response.sendStatus(204)
  }))

  admin.patch('/members/:id/access', write(async (request, response) => {
    const id = z.uuid().safeParse(request.params.id)
    const input = z.object({ active: z.boolean() }).safeParse(request.body)
    if (!id.success || !input.success) { fail(response); return }
    await database.$transaction(async (tx) => {
      const record = await tx.member.findUniqueOrThrow({ where: { id: id.data } })
      if (record.archivedAt) throw new Conflict('Archived members cannot sign in.')
      await tx.user.update({ where: { id: record.userId }, data: { active: input.data.active } })
      if (!input.data.active) {
        await tx.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } })
        await tx.accountChallenge.deleteMany({ where: { userId: record.userId } })
      }
      await logChange(tx, response.locals.account.id, input.data.active ? 'ACCESS_ENABLED' : 'ACCESS_DISABLED', 'Member', record.id)
    }, { isolationLevel: 'Serializable' })
    response.sendStatus(204)
  }))

  admin.post('/members/:id/archive', write(async (request, response) => {
    const id = z.uuid().safeParse(request.params.id)
    if (!id.success) { fail(response); return }
    await database.$transaction(async (tx) => {
      const record = await tx.member.findUniqueOrThrow({ where: { id: id.data } })
      if (record.archivedAt) return
      await tx.user.update({ where: { id: record.userId }, data: { active: false } })
      await tx.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } })
      await tx.accountChallenge.deleteMany({ where: { userId: record.userId } })
      await tx.member.update({ where: { id: record.id }, data: { archivedAt: new Date() } })
      await tx.membership.updateMany({ where: { memberId: record.id }, data: { endsOn: gymToday() } })
      await logChange(tx, response.locals.account.id, 'MEMBER_ARCHIVED', 'Member', record.id)
    }, { isolationLevel: 'Serializable' })
    response.sendStatus(204)
  }))

  admin.delete('/members/:id', write(async (request, response) => {
    const id = z.uuid().safeParse(request.params.id)
    if (!id.success) { fail(response); return }
    await database.$transaction(async (tx) => {
      const record = await tx.member.findUniqueOrThrow({ where: { id: id.data } })
      const bills = await tx.bill.count({ where: { membership: { memberId: record.id } } })
      if (bills) throw new Conflict('This member has billing history. Archive the member to preserve their records.')
      await tx.membership.deleteMany({ where: { memberId: record.id } })
      await tx.member.delete({ where: { id: record.id } })
      await tx.user.delete({ where: { id: record.userId } })
      await logChange(tx, response.locals.account.id, 'MEMBER_DELETED', 'Member', record.id)
    }, { isolationLevel: 'Serializable' })
    response.sendStatus(204)
  }))

  admin.get('/plans', async (_request, response) => {
    response.json({ plans: await database.feePlan.findMany({ orderBy: [{ intervalMonths: 'asc' }, { name: 'asc' }], select: planFields }) })
  })

  admin.post('/plans', write(async (request, response) => {
    const plan = planInput.safeParse(request.body)
    if (!plan.success) { fail(response); return }
    const created = await database.$transaction(async (tx) => {
      const record = await tx.feePlan.create({ data: plan.data, select: planFields })
      await logChange(tx, response.locals.account.id, 'PLAN_CREATED', 'FeePlan', record.id)
      return record
    })
    response.status(201).json({ plan: created })
  }))

  admin.patch('/plans/:id', write(async (request, response) => {
    const plan = planInput.safeParse(request.body)
    const id = z.uuid().safeParse(request.params.id)
    if (!plan.success || !id.success) { fail(response); return }
    const updated = await database.$transaction(async (tx) => {
      const record = await tx.feePlan.update({ where: { id: id.data }, data: plan.data, select: planFields })
      await logChange(tx, response.locals.account.id, 'PLAN_UPDATED', 'FeePlan', record.id)
      return record
    })
    response.json({ plan: updated })
  }))

  member.get('/dashboard', async (request, response) => {
    const page = pageNumber.safeParse(request.query.billPage)
    if (!page.success) { fail(response); return }
    const today = gymToday()
    const userId: string = response.locals.account.id
    const profile = await database.member.findUnique({ where: { userId }, select: cardFields })
    const membership = { member: { userId, archivedAt: null } }
    const [history, openBill] = await Promise.all([
      billHistory(database, { membership }, page.data),
      database.bill.findFirst({ where: { membership, status: 'OPEN' }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], select: billFields }),
    ])
    response.json({ profile, ...history, openBill, today })
  })

  mountBillingRoutes(admin, member, database)
  mountNotificationRoutes(admin, database)
  mountNotificationRoutes(member, database)
  return { admin, member }
}
