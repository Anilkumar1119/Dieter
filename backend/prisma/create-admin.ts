import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { createDatabaseClient } from '../src/db.js'

const { DATABASE_URL, ADMIN_BOOTSTRAP_PHONE, ADMIN_BOOTSTRAP_PASSWORD } = process.env
if (!DATABASE_URL || !ADMIN_BOOTSTRAP_PHONE || !/^\+[1-9]\d{7,14}$/.test(ADMIN_BOOTSTRAP_PHONE) ||
    !ADMIN_BOOTSTRAP_PASSWORD || ADMIN_BOOTSTRAP_PASSWORD.length < 12 ||
    Buffer.byteLength(ADMIN_BOOTSTRAP_PASSWORD) > 72) {
  throw new Error('Set DATABASE_URL, ADMIN_BOOTSTRAP_PHONE in international format, and a strong ADMIN_BOOTSTRAP_PASSWORD.')
}

const database = createDatabaseClient(DATABASE_URL)
try {
  await database.user.create({
    data: {
      phone: ADMIN_BOOTSTRAP_PHONE,
      role: 'ADMIN',
      passwordHash: await bcrypt.hash(ADMIN_BOOTSTRAP_PASSWORD, 12),
      accountActivatedAt: new Date(),
    },
  })
  console.log('Admin account created.')
} catch {
  console.error('Could not create the admin. Check connectivity and whether the phone is already registered.')
  process.exitCode = 1
} finally {
  await database.$disconnect()
}
