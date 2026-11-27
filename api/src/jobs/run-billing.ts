import 'dotenv/config'
import { createDatabaseClient } from '../db.js'
import { issueDueBills } from '../gym/billing.js'

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running billing.')
const database = createDatabaseClient(process.env.DATABASE_URL)
try {
  console.log(await issueDueBills(database))
} finally {
  await database.$disconnect()
}
