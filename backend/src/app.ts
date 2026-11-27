import { timingSafeEqual } from 'node:crypto'
import express, { type ErrorRequestHandler } from 'express'
import helmet from 'helmet'
import { fileURLToPath } from 'node:url'
import { createAuth } from './auth/routes.js'
import { createEmailVerification } from './auth/email.js'
import { createDatabaseClient } from './db.js'
import { createGymRoutes } from './gym/routes.js'
import { startReminderSchedule } from './jobs/reminder-schedule.js'
import { runReminderJob } from './gym/reminders.js'

const app = express()
const webDirectory = fileURLToPath(new URL('../../web/dist/', import.meta.url))
const secure = process.env.NODE_ENV === 'production'
const { AUTH_SECRET, DATABASE_URL } = process.env
const hostedDomain = process.env.VERCEL_ENV === 'production'
  ? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  : process.env.VERCEL_URL
const appOrigin = process.env.APP_ORIGIN ?? (hostedDomain ? 'https://' + hostedDomain : 'http://localhost:5173')

app.disable('x-powered-by')
if (process.env.VERCEL === '1') app.set('trust proxy', 1)
app.use(helmet({
  strictTransportSecurity: secure,
  contentSecurityPolicy: secure ? undefined : { directives: { upgradeInsecureRequests: null } },
}))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

if (DATABASE_URL) {
  if (!AUTH_SECRET || !/^[a-fA-F0-9]{64}$/.test(AUTH_SECRET)) {
    throw new Error('Set AUTH_SECRET to a random 32-byte hex string.')
  }
  const origin = new URL(appOrigin)
  if (origin.origin !== appOrigin || (secure && origin.protocol !== 'https:')) {
    throw new Error('Set APP_ORIGIN to the browser origin, using HTTPS in production.')
  }
  const database = createDatabaseClient(DATABASE_URL)
  const auth = createAuth(database, {
    secret: Buffer.from(AUTH_SECRET, 'hex'),
    origin: origin.origin,
    secure,
    email: createEmailVerification(),
  })
  app.use('/api/auth', auth.router)
  const gym = createGymRoutes(database, auth, origin.origin)
  app.use('/api/admin', gym.admin)
  app.use('/api/member', gym.member)
  app.get('/api/ready', async (_request, response) => {
    await database.$queryRaw`SELECT 1 FROM "JobRun" LIMIT 1`
    response.json({ ready: true })
  })

  app.get('/api/cron/reminders', async (request, response) => {
    const secret = process.env.CRON_SECRET
    const provided = Buffer.from(request.get('Authorization') ?? '')
    const expected = Buffer.from('Bearer ' + secret)
    if (!secret || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      response.sendStatus(401)
      return
    }
    response.set('Cache-Control', 'no-store').json(await runReminderJob(database))
  })

  if (process.env.VERCEL !== '1' && process.env.REMINDER_CRON_ENABLED === 'true') {
    startReminderSchedule(database)
  }
} else if (secure) {
  throw new Error('Set DATABASE_URL to enable authentication in production.')
} else {
  app.use('/api/auth', (_request, response) => {
    response.status(503).json({ error: 'Account access is unavailable. Configure the database and authentication settings.' })
  })
}

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API route not found.' })
})

if (process.env.VERCEL !== '1') {
  app.use(express.static(webDirectory))
  app.get(['/member/login', '/admin/login', '/admin/setup', '/member/setup', '/member/reset'], (_request, response) => {
    response.sendFile('index.html', { root: webDirectory })
  })
}

const handleError: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) { next(error); return }
  if (error.status === 400 || error.status === 413 || error.status === 404) {
    response.status(error.status).json({ error: 'The request could not be completed.' })
    return
  }
  console.error('An API request failed.')
  response.status(500).json({ error: 'The server could not complete the request.' })
}
app.use(handleError)

export default app
