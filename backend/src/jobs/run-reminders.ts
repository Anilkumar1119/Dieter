import 'dotenv/config'
import { createDatabaseClient } from '../db.js'
import { runReminderJob } from '../gym/reminders.js'

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running reminders.')
const database = createDatabaseClient(process.env.DATABASE_URL)
try {
  console.log(await runReminderJob(database))
} finally {
  await database.$disconnect()
}
