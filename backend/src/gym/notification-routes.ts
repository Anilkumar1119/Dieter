import express, { type Router } from 'express'
import { z } from 'zod'
import type { PrismaClient } from '../generated/prisma/client.js'

export function mountNotificationRoutes(router: Router, database: PrismaClient) {
  router.get('/notifications', async (request, response) => {
    const input = z.coerce.number().int().min(1).max(100_000).default(1).safeParse(request.query.page)
    if (!input.success) { response.status(400).json({ error: 'Choose a valid notification page.' }); return }
    const recipientId: string = response.locals.account.id
    const size = 20
    const [items, unread, total] = await Promise.all([
      database.notification.findMany({
        where: { recipientId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.data - 1) * size, take: size,
        select: { id: true, message: true, kind: true, createdAt: true, readAt: true },
      }),
      database.notification.count({ where: { recipientId, readAt: null } }),
      database.notification.count({ where: { recipientId } }),
    ])
    response.json({ items, unread, page: input.data, pages: Math.max(1, Math.ceil(total / size)) })
  })
  router.patch('/notifications/read-all', express.json({ limit: '1kb' }), async (_request, response) => {
    await database.notification.updateMany({
      where: { recipientId: response.locals.account.id, readAt: null }, data: { readAt: new Date() },
    })
    response.sendStatus(204)
  })
  router.patch('/notifications/:id/read', express.json({ limit: '1kb' }), async (request, response) => {
    const id = z.uuid().safeParse(request.params.id)
    if (!id.success) { response.status(404).json({ error: 'Notification not found.' }); return }
    const where = { id: id.data, recipientId: response.locals.account.id }
    const changed = await database.notification.updateMany({
      where: { ...where, readAt: null }, data: { readAt: new Date() },
    })
    if (!changed.count && !await database.notification.findFirst({ where, select: { id: true } })) {
      response.status(404).json({ error: 'Notification not found.' }); return
    }
    response.sendStatus(204)
  })
}
