import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import express, { type RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'
import { Prisma, type PrismaClient, type UserRole } from '../generated/prisma/client.js'
import type { EmailVerification } from './email.js'

const sessionDuration = 8 * 60 * 60
const challengeDuration = 10 * 60 * 1000
const resendDelay = 60 * 1000
export const phone = z.string().trim().max(32).transform((value) => {
  const normalized = value.replace(/[\s()-]/g, '')
  return /^[6-9]\d{9}$/.test(normalized) ? '+91' + normalized : normalized
}).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/))
export const memberEmail = z.string().trim().toLowerCase().pipe(z.email().max(254))
const phoneInput = z.object({ phone })
const loginInput = phoneInput.extend({ password: z.string().min(1).max(72).refine((value) => Buffer.byteLength(value) <= 72) })
const emailInput = z.object({ email: memberEmail })
const codeInput = emailInput.extend({ code: z.string().regex(/^\d{6}$/) })
const setupToken = z.string().regex(/^[0-9a-f]{64}$/i)
const bootstrapInput = phoneInput.extend({
  token: setupToken,
  password: z.string().min(12).max(72).refine((value) => Buffer.byteLength(value) <= 72),
})
const invalidInput = 'Check the phone number and password and try again.'
const invalidCode = 'The code is invalid or expired. Request a new code and try again.'
const sent = 'If this address is registered for an active membership, you’ll get a sign-in code. Check your inbox and spam folder.'
const emailUnavailable = 'Email verification is unavailable. Ask the gym to check its email setup.'
const purpose = 'SIGN_IN' as const
const sessionIssuer = 'gym-member-management'

export function protectAccountRequests(origin: string): RequestHandler {
  return (request, response, next) => {
    response.set('Cache-Control', 'no-store')
    // These endpoints accept same-origin browser requests and same-origin JSON writes only.
    if (!['GET', 'HEAD'].includes(request.method) &&
        (request.get('Origin') !== origin || !request.is('application/json'))) {
      response.status(403).json({ error: 'This request is not allowed.' })
      return
    }
    next()
  }
}

export function createAuth(
  database: PrismaClient,
  options: { secret: Uint8Array; origin: string; secure: boolean; email?: EmailVerification },
) {
  const router = express.Router()
  const cookieName = options.secure ? '__Host-gym_session' : 'gym_session'
  const cookie = { httpOnly: true, secure: options.secure, sameSite: 'lax' as const, path: '/' }
  const dummyHash = bcrypt.hashSync(randomUUID(), 12)

  const requireSession: RequestHandler = async (request, response, next) => {
    const value = request.headers.cookie?.split(';').map((part) => part.trim())
      .find((part) => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
    if (!value) { response.status(401).json({ error: 'Sign in to continue.' }); return }
    let sessionId: string
    try {
      const { payload } = await jwtVerify(value, options.secret, {
        algorithms: ['HS256'], issuer: sessionIssuer, audience: sessionIssuer,
        requiredClaims: ['sub', 'exp'],
      })
      if (!z.uuid().safeParse(payload.sub).success) throw new Error('Invalid session ID.')
      sessionId = payload.sub!
    } catch {
      response.status(401).json({ error: 'Sign in to continue.' })
      return
    }
    const session = await database.session.findFirst({
      where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() }, user: { active: true } },
      select: { id: true, user: { select: { id: true, role: true, phone: true } } },
    })
    if (!session) { response.status(401).json({ error: 'Sign in to continue.' }); return }
    response.locals.account = session.user
    response.locals.sessionId = session.id
    next()
  }

  function requireRole(role: UserRole): RequestHandler {
    return (_request, response, next) => {
      if (response.locals.account?.role !== role) {
        response.status(403).json({ error: 'Your account cannot use this action.' })
        return
      }
      next()
    }
  }

  router.use(protectAccountRequests(options.origin))
  router.use(express.json({ limit: '8kb' }))

  const limit = (count: number) => rateLimit({
    windowMs: 15 * 60_000, limit: count, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many attempts. Try again later.' },
  })

  const limitSignInByPhone = rateLimit({
    windowMs: 15 * 60_000, limit: 15, standardHeaders: false, legacyHeaders: false,
    skip: (request) => !phoneInput.safeParse(request.body).success,
    keyGenerator: (request) => phoneInput.parse(request.body).phone,
    message: { error: 'Too many attempts. Try again later.' },
  })

  const adminLogin: RequestHandler = async (request, response) => {
    const input = loginInput.safeParse(request.body)
    if (!input.success) { response.status(400).json({ error: invalidInput }); return }
    const user = await database.user.findUnique({ where: { phone: input.data.phone } })
    const matches = await bcrypt.compare(input.data.password, user?.passwordHash ?? dummyHash)
    if (!matches || !user?.active || user.role !== 'ADMIN' || !user.passwordHash || !user.accountActivatedAt) {
      response.status(401).json({ error: 'Phone number or password is incorrect.' })
      return
    }
    const dbSession = await database.$transaction(async (transaction) => {
      // Lock the user row through this guarded update so a concurrent reset or deactivation
      // cannot invalidate access before a new session has been created.
      const active = await transaction.user.updateMany({
        where: { id: user.id, active: true, passwordHash: user.passwordHash },
        data: { updatedAt: new Date() },
      })
      if (!active.count) return null
      return transaction.session.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() + sessionDuration * 1000) },
      })
    })
    if (!dbSession) { response.status(401).json({ error: 'Phone number or password is incorrect.' }); return }
    await sendSession(response, dbSession, user)
  }

  async function sendSession(response: express.Response, session: { id: string; expiresAt: Date },
    user: { id: string; role: UserRole; phone: string }) {
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
      .setSubject(session.id).setIssuer(sessionIssuer).setAudience(sessionIssuer)
      .setIssuedAt().setExpirationTime(Math.floor(session.expiresAt.getTime() / 1000)).sign(options.secret)
    response.cookie(cookieName, token, { ...cookie, maxAge: sessionDuration * 1000 })
    response.json({ account: { id: user.id, role: user.role, phone: user.phone } })
  }

  function digestCode(deliveryId: string, code: string) {
    return createHmac('sha256', options.secret).update('dieter-email-otp:' + deliveryId + ':' + code).digest()
  }

  async function sendCode(sender: EmailVerification, userId: string, email: string) {
    const now = new Date()
    const deliveryId = randomUUID()
    const code = randomInt(1_000_000).toString().padStart(6, '0')
    const fields = {
      deliveryId, otpEmail: email, codeDigest: null, expiresAt: new Date(now.getTime() + challengeDuration),
      createdAt: now, usedAt: null, attempts: 0,
    }
    const current = await database.accountChallenge.updateMany({
      where: { userId, purpose, createdAt: { lte: new Date(now.getTime() - resendDelay) } },
      data: fields,
    })
    if (!current.count) {
      try {
        await database.accountChallenge.create({ data: { userId, purpose, ...fields } })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'cooldown'
        throw error
      }
    }
    await sender.send({ to: email, code, requestId: deliveryId })
    const saved = await database.accountChallenge.updateMany({
      where: { userId, purpose, deliveryId, user: { active: true, member: { loginEmail: email, archivedAt: null } } },
      data: { codeDigest: digestCode(deliveryId, code).toString('hex') },
    })
    return saved.count ? 'sent' : 'changed'
  }

  function requestCode(admin = false): RequestHandler {
    return async (request, response) => {
      const input = emailInput.safeParse(request.body)
      if (!input.success) { response.status(400).json({ error: 'Enter a valid email address.' }); return }
      if (!options.email) { response.status(503).json({ error: emailUnavailable }); return }

      const { email } = input.data
      const eligible = await database.user.findFirst({
        where: { role: 'MEMBER', active: true, member: { loginEmail: email, archivedAt: null } },
        select: { id: true },
      })
      if (!eligible) {
        if (admin) response.status(409).json({ error: 'An active member with this registered email address is required.' })
        else response.status(202).json({ message: sent })
        return
      }
      try {
        const status = await sendCode(options.email, eligible.id, email)
        const adminMessages = {
          sent: 'Resend accepted the sign-in email.',
          cooldown: 'Wait one minute before requesting another code.',
          changed: 'The account changed while sending the code. Try again.',
        }
        response.status(202).json({ message: admin ? adminMessages[status] : sent })
      } catch {
        console.error('Member verification email could not be sent.')
        if (admin) response.status(503).json({ error: emailUnavailable })
        else response.status(202).json({ message: sent })
      }
    }
  }

  const verifyCode: RequestHandler = async (request, response) => {
    const input = codeInput.safeParse(request.body)
    if (!input.success) { response.status(400).json({ error: 'Check your email address and six-digit code.' }); return }
    const { email, code } = input.data
    const recipient = { loginEmail: email, archivedAt: null }
    const challenge = await database.accountChallenge.findFirst({
      where: {
        purpose, otpEmail: email, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 },
        codeDigest: { not: null },
        user: { role: 'MEMBER', active: true, member: recipient },
      },
    })
    if (!challenge?.codeDigest) { response.status(400).json({ error: invalidCode }); return }
    const challengeVersion = { id: challenge.id, deliveryId: challenge.deliveryId }
    const available = await database.accountChallenge.updateMany({
      where: { ...challengeVersion, usedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } },
      data: { attempts: { increment: 1 } },
    })
    if (!available.count) { response.status(400).json({ error: invalidCode }); return }
    const expected = Buffer.from(challenge.codeDigest, 'hex')
    const actual = digestCode(challenge.deliveryId, code)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      response.status(400).json({ error: invalidCode })
      return
    }

    const result = await database.$transaction(async (transaction) => {
      // Use the same account-first lock order as member email changes and deactivation.
      const account = await transaction.user.updateMany({
        where: { id: challenge.userId, role: 'MEMBER', active: true, member: recipient },
        data: { updatedAt: new Date() },
      })
      if (!account.count) return null
      const consumed = await transaction.accountChallenge.updateMany({
        where: { ...challengeVersion, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date(), codeDigest: null },
      })
      if (!consumed.count) return null
      await transaction.user.updateMany({
        where: { id: challenge.userId, accountActivatedAt: null },
        data: { accountActivatedAt: new Date() },
      })
      const session = await transaction.session.create({
        data: { userId: challenge.userId, expiresAt: new Date(Date.now() + sessionDuration * 1000) },
        include: { user: { select: { id: true, role: true, phone: true } } },
      })
      return session
    })
    if (!result) { response.status(400).json({ error: invalidCode }); return }
    await sendSession(response, result, result.user)
  }

  async function hasAdmin(client: Prisma.TransactionClient | PrismaClient) {
    return Boolean(await client.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } }))
  }

  router.get('/admin/setup', limit(30), async (_request, response) => {
    const status = await hasAdmin(database) ? 'closed'
      : setupToken.safeParse(process.env.ADMIN_SETUP_TOKEN).success ? 'available' : 'unconfigured'
    response.json({ status })
  })

  router.post('/admin/setup', limit(5), async (request, response) => {
    const configured = setupToken.safeParse(process.env.ADMIN_SETUP_TOKEN)
    if (!configured.success) { response.status(503).json({ error: 'Admin setup is not configured.' }); return }
    const input = bootstrapInput.safeParse(request.body)
    if (!input.success) {
      response.status(400).json({ error: 'Check your phone number, setup token and password length (12 characters to 72 bytes).' })
      return
    }
    const provided = Buffer.from(input.data.token, 'hex')
    const expected = Buffer.from(configured.data, 'hex')
    if (!timingSafeEqual(provided, expected)) {
      response.status(403).json({ error: 'The setup token is incorrect.' })
      return
    }
    if (await hasAdmin(database)) {
      response.status(409).json({ error: 'An admin account already exists. First admin setup is closed.' })
      return
    }

    const passwordHash = await bcrypt.hash(input.data.password, 12)
    try {
      const created = await database.$transaction(async (transaction) => {
        // Recheck in a serializable transaction so simultaneous requests cannot both create the first admin.
        if (await hasAdmin(transaction)) return false
        const admin = await transaction.user.create({
          data: { phone: input.data.phone, role: 'ADMIN', passwordHash, accountActivatedAt: new Date() },
          select: { id: true },
        })
        await transaction.auditLog.create({
          data: { actorId: admin.id, action: 'ADMIN_BOOTSTRAPPED', entityType: 'User', entityId: admin.id },
        })
        return true
      }, { isolationLevel: 'Serializable' })
      if (created) { response.status(201).json({ message: 'Admin account created. You can now sign in.' }); return }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        response.status(409).json({ error: 'That mobile number is already assigned to an account.' })
        return
      }
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error
    }
    response.status(409).json({ error: 'Admin setup was completed or changed. Refresh the setup page.' })
  })

  router.post('/admin/login', limit(15), limitSignInByPhone, adminLogin)
  router.post('/member/code/request', limit(10), requestCode())
  router.post('/member/code/verify', limit(20), verifyCode)
  router.post('/admin/invitations', requireSession, requireRole('ADMIN'), limit(30), requestCode(true))
  router.get('/me', requireSession, (_request, response) => response.json({ account: response.locals.account }))
  router.post('/logout', requireSession, async (_request, response) => {
    await database.session.updateMany({
      where: { id: response.locals.sessionId, revokedAt: null }, data: { revokedAt: new Date() },
    })
    response.clearCookie(cookieName, cookie).sendStatus(204)
  })

  return { router, requireSession, requireRole }
}
