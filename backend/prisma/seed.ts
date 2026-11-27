import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { createDatabaseClient } from '../src/db.js'

const { DATABASE_URL, DEMO_SEED_PASSWORD, NODE_ENV } = process.env

if (NODE_ENV === 'production') {
  throw new Error('Demo data can only be seeded outside production.')
}

if (!DATABASE_URL || !DEMO_SEED_PASSWORD || DEMO_SEED_PASSWORD.length < 12 ||
    Buffer.byteLength(DEMO_SEED_PASSWORD) > 72) {
  throw new Error('Set DATABASE_URL and a demo password with at least 12 characters and at most 72 bytes.')
}

const database = createDatabaseClient(DATABASE_URL)
const on = (date: string) => new Date(`${date}T00:00:00.000Z`)

try {
  const passwordHash = await bcrypt.hash(DEMO_SEED_PASSWORD, 12)
  const verifiedAt = on('2026-11-01')
  await database.$transaction(async (transaction) => {
    const admin = await transaction.user.upsert({
      where: { phone: '+12025550100' },
      update: {},
      create: { phone: '+12025550100', role: 'ADMIN', passwordHash, accountActivatedAt: verifiedAt },
    })

    const sampleMembers = [
      { fullName: 'Aarav Demo', age: 28, phone: '+12025550101', plan: 'Monthly', price: 100000,
        interval: 1, start: '2026-11-01', end: '2026-12-01', paid: true },
      { fullName: 'Diya Demo', age: 24, phone: '+12025550102', plan: 'Quarterly', price: 270000,
        interval: 3, start: '2026-11-20', end: '2027-02-20', paid: false },
      { fullName: 'Kabir Demo', age: 31, phone: '+12025550103', plan: 'Annual', price: 1000000,
        interval: 12, start: '2026-11-29', end: '2027-11-29', paid: false },
    ]

    for (const sample of sampleMembers) {
      const plan = await transaction.feePlan.upsert({
        where: { name: sample.plan },
        update: {},
        create: { name: sample.plan, amountPaise: sample.price, intervalMonths: sample.interval },
      })
      const user = await transaction.user.upsert({
        where: { phone: sample.phone },
        update: {},
        create: { phone: sample.phone, role: 'MEMBER', passwordHash, accountActivatedAt: verifiedAt },
      })
      const member = await transaction.member.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, fullName: sample.fullName, age: sample.age, admissionDate: on(sample.start) },
      })
      const membership = await transaction.membership.upsert({
        where: { memberId: member.id },
        update: {},
        create: {
          memberId: member.id,
          currentPlanId: plan.id,
          cycleAnchorDate: on(sample.start),
          nextBillingDate: on(sample.end),
        },
      })
      const bill = await transaction.bill.upsert({
        where: { membershipId_periodStart: { membershipId: membership.id, periodStart: on(sample.start) } },
        update: {},
        create: {
          membershipId: membership.id,
          periodStart: on(sample.start),
          periodEnd: on(sample.end),
          dueDate: on(sample.start),
          amountPaise: sample.price,
          planName: sample.plan,
          planIntervalMonths: sample.interval,
          status: sample.paid ? 'PAID' : 'OPEN',
        },
      })
      if (sample.paid) {
        await transaction.payment.upsert({
          where: { receiptNumber: 'DEMO-0001' },
          update: {},
          create: {
            billId: bill.id, receiptNumber: 'DEMO-0001', amountPaise: sample.price,
            method: 'CASH', receivedAt: on(sample.start), recordedById: admin.id,
          },
        })
      }
    }
  })
  console.log('Demo data ready: one admin, three members, three fee plans and one receipt.')
} finally {
  await database.$disconnect()
}
