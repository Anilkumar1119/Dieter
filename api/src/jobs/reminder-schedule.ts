import cron from 'node-cron'
import type { PrismaClient } from '../generated/prisma/client.js'
import { reminderDays, runReminderJob } from '../gym/reminders.js'

export function startReminderSchedule(database: PrismaClient) {
  const days = reminderDays()
  return cron.schedule('0 9 * * *', async () => {
    try {
      console.info('Daily reminders:', await runReminderJob(database, new Date(), days))
    } catch (error) {
      console.error('The daily reminder job failed.', error instanceof Error ? error.name : 'UnknownError')
    }
  }, { timezone: 'Asia/Kolkata', noOverlap: true })
}
