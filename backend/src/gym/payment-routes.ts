import type { Router, RequestHandler } from 'express'
import { z } from 'zod'
import type { PrismaClient } from '../generated/prisma/client.js'
import { gymToday } from './billing-dates.js'
import { issueDueBills, serializable } from './billing.js'
import { sendReceipt } from './receipt.js'

const packet = z.object({
  paymentId: z.uuid(),
  method: z.enum(['CASH', 'BANK_TRANSFER']),
  receivedOn: z.iso.date(),
  reference: z.string().trim().max(120).transform((value) => value || null),
})
class PaymentConflict extends Error {}

export function mountBillingRoutes(admin: Router, member: Router, database: PrismaClient) {
  admin.post('/billing/run', async (_request, response) => {
    response.json(await issueDueBills(database))
  })

  admin.post('/bills/:id/payments', async (request, response) => {
    const billId = z.uuid().safeParse(request.params.id)
    const payment = packet.safeParse(request.body)
    if (!billId.success || !payment.success) {
      response.status(400).json({ error: 'Check the payment method, date and reference.' })
      return
    }
    const data = payment.data
    const day = new Date(data.receivedOn)
    const now = new Date()
    const today = gymToday(now)
    if (day > today) {
      response.status(400).json({ error: 'The payment date cannot be in the future.' })
      return
    }
    const date = day.getTime() === today.getTime() ? now : day
    const adminId: string = response.locals.account.id
    try {
      const result = await serializable(database, async (transaction) => {
        const previous = await transaction.payment.findUnique({ where: { id: data.paymentId } })
        if (previous) {
          if (previous.billId !== billId.data || previous.method !== data.method ||
              previous.reference !== data.reference || gymToday(previous.receivedAt).getTime() !== day.getTime()) {
            throw new PaymentConflict('This payment request was already used with other details.')
          }
          return { payment: previous, created: false }
        }
        const bill = await transaction.bill.findUnique({
          where: { id: billId.data },
          select: { id: true, periodStart: true, status: true, amountPaise: true },
        })
        if (!bill) return null
        if (bill.status !== 'OPEN') throw new PaymentConflict('This bill is no longer open.')
        if (day < bill.periodStart) throw new PaymentConflict('The payment date cannot be earlier than the billing period.')
        const { _sum } = await transaction.payment.aggregate({
          where: { billId: bill.id }, _sum: { amountPaise: true },
        })
        const remaining = bill.amountPaise - (_sum.amountPaise ?? 0)
        if (remaining <= 0) throw new PaymentConflict('This bill has no remaining balance.')
        const receiptNumber = 'GYM-' + data.paymentId.toUpperCase()
        const created = await transaction.payment.create({
          data: {
            id: data.paymentId, billId: bill.id, amountPaise: remaining, method: data.method,
            reference: data.reference, receivedAt: date, recordedById: adminId, receiptNumber,
          },
        })
        await transaction.bill.update({ where: { id: bill.id }, data: { status: 'PAID' } })
        await transaction.auditLog.create({
          data: { actorId: adminId, action: 'PAYMENT_RECORDED', entityType: 'Payment', entityId: created.id, details: { billId: bill.id } },
        })
        return { payment: created, created: true }
      }, true)
      if (!result) { response.status(404).json({ error: 'Bill not found.' }); return }
      response.status(result.created ? 201 : 200).json({
        payment: { id: result.payment.id, receiptNumber: result.payment.receiptNumber, amountPaise: result.payment.amountPaise },
      })
    } catch (error) {
      if (error instanceof PaymentConflict) {
        response.status(409).json({ error: error.message })
        return
      }
      throw error
    }
  })

  function receipt(memberOnly: boolean): RequestHandler {
    return async (request, response) => {
      const id = z.uuid().safeParse(request.params.id)
      if (!id.success) { response.status(404).json({ error: 'Receipt not found.' }); return }
      const payment = await database.payment.findFirst({
        where: {
          id: id.data,
          ...(memberOnly ? { bill: { membership: { member: { userId: response.locals.account.id } } } } : {}),
        },
        include: { bill: { include: { membership: { include: { member: { select: { fullName: true } } } } } } },
      })
      if (!payment) { response.status(404).json({ error: 'Receipt not found.' }); return }
      sendReceipt(response, payment, request.query.download === '1')
    }
  }

  admin.get('/payments/:id/receipt', receipt(false))
  member.get('/payments/:id/receipt', receipt(true))
}
