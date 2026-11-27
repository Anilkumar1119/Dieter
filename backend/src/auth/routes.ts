import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import express, { type RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'
import { Prisma, type PrismaClient, type UserRole } from '../generated/prisma/client.js'
import type { SmsVerification } from './sms.js'

const sessionDuration = 8 * 60 * 60
const challengeDuration = 10 * 60 * 1000
const resendDelay = 60 * 1000
export const phone = z.string().trim().max(32).transform((value) => {
  const normalized = value.replace(/[\s()-]/g, '')
  return /^[6-9]\d{9}$/.test(normalized) ? '+91' + normalized : normalized
}).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/))
const password = z.string().min(12).max(72).refine((value) => Buffer.byteLength(value) <= 72)
const phoneInput = z.object({ phone })
const loginInput = phoneInput.extend({ password: z.string().min(1).max(72).refine((value) => Buffer.byteLength(value) <= 72) })
const codeInput = phoneInput.extend({ password, code: z.string().regex(/^\d{4,10}$/) })
const invalidInput = 'Check the phone number and other fields and try again.'
const invalidCode = 'The code is invalid or expired. Request a new code and try again.'
const sent = 'If this account is eligible, a verification code will be sent.'
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
  options: { secret: Uint8Array; origin: string; secure: boolean; sms?: SmsVerification },
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

  function login(role: UserRole): RequestHandler {
    return async (request, response) => {
      const input = loginInput.safeParse(request.body)
      if (!input.success) { response.status(400).json({ error: invalidInput }); return }
      const user = await database.user.findUnique({ where: { phone: input.data.phone } })
      const matches = await bcrypt.compare(input.data.password, user?.passwordHash ?? dummyHash)
      if (!matches || !user?.active || user.role !== role || !user.passwordHash || !user.phoneVerifiedAt) {
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
      const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
        .setSubject(dbSession.id).setIssuer(sessionIssuer).setAudience(sessionIssuer)
        .setIssuedAt().setExpirationTime(Math.floor(dbSession.expiresAt.getTime() / 1000)).sign(options.secret)
      response.cookie(cookieName, token, { ...cookie, maxAge: sessionDuration * 1000 })
      response.json({ account: { id: user.id, role: user.role, phone: user.phone } })
    }
  }

  async function sendCode(userId: string, number: string, purpose: 'SETUP' | 'PASSWORD_RESET') {
    const now = new Date()
    const reservation = 'pending:' + randomUUID()
    const fields = {
      providerReference: reservation, expiresAt: new Date(now.getTime() + challengeDuration),
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
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return
        throw error
      }
    }
    const reference = await options.sms!.send(number)
    await database.accountChallenge.updateMany({
      where: { userId, purpose, providerReference: reservation },
      data: { providerReference: reference },
    })
  }

  function requestCode(purpose: 'SETUP' | 'PASSWORD_RESET'): RequestHandler {
    return async (request, response) => {
      const input = phoneInput.safeParse(request.body)
      if (!input.success) { response.status(400).json({ error: invalidInput }); return }
      if (!options.sms) { response.status(503).json({ error: 'SMS verification is unavailable.' }); return }
      const eligible = await database.user.findFirst({
        where: { phone: input.data.phone, role: 'MEMBER', active: true, passwordHash: purpose === 'SETUP' ? null : { not: null } },
      })
      if (eligible) {
        try { await sendCode(eligible.id, eligible.phone, purpose) }
        catch { console.error('Member verification could not be sent.') }
      }
      response.status(202).json({ message: sent })
    }
  }

  function completeCode(purpose: 'SETUP' | 'PASSWORD_RESET'): RequestHandler {
    return async (request, response) => {
      const input = codeInput.safeParse(request.body)
      if (!input.success) { response.status(400).json({ error: invalidInput }); return }
      if (!options.sms) { response.status(503).json({ error: 'SMS verification is unavailable.' }); return }
      const { phone: number, code, password: newPassword } = input.data
      const expectedPassword = purpose === 'SETUP' ? null : { not: null }
      const challenge = await database.accountChallenge.findFirst({
        where: {
          purpose, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 },
          providerReference: { not: { startsWith: 'pending:' } },
          user: { phone: number, role: 'MEMBER', active: true, passwordHash: expectedPassword },
        },
      })
      if (!challenge) { response.status(400).json({ error: invalidCode }); return }
      const challengeVersion = { id: challenge.id, providerReference: challenge.providerReference, createdAt: challenge.createdAt }
      const available = await database.accountChallenge.updateMany({
        where: { ...challengeVersion, usedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } },
        data: { attempts: { increment: 1 } },
      })
      if (!available.count) { response.status(400).json({ error: invalidCode }); return }
      let approved: boolean
      try { approved = await options.sms.check(challenge.providerReference, code) }
      catch { response.status(503).json({ error: 'SMS verification is unavailable.' }); return }
      if (!approved) { response.status(400).json({ error: invalidCode }); return }

      const passwordHash = await bcrypt.hash(newPassword, 12)
      const updated = await database.$transaction(async (transaction) => {
        // All credential changes lock the account before touching its challenges or sessions.
        const account = await transaction.user.updateMany({
          where: { id: challenge.userId, role: 'MEMBER', active: true, passwordHash: expectedPassword },
          data: { updatedAt: new Date() },
        })
        if (!account.count) return false
        const consumed = await transaction.accountChallenge.updateMany({
          where: { ...challengeVersion, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        })
        if (!consumed.count) return false
        await transaction.user.update({
          where: { id: challenge.userId },
          data: { passwordHash, phoneVerifiedAt: new Date() },
        })
        await transaction.session.updateMany({
          where: { userId: challenge.userId, revokedAt: null }, data: { revokedAt: new Date() },
        })
        return true
      })
      if (!updated) { response.status(400).json({ error: invalidCode }); return }
      response.json({ message: 'Password saved. You can now sign in.' })
    }
  }

  router.post('/member/login', limit(20), limitSignInByPhone, login('MEMBER'))
  router.post('/admin/login', limit(15), limitSignInByPhone, login('ADMIN'))
  router.post('/setup/request', limit(10), requestCode('SETUP'))
  router.post('/setup/complete', limit(20), completeCode('SETUP'))
  router.post('/reset/request', limit(10), requestCode('PASSWORD_RESET'))
  router.post('/reset/complete', limit(20), completeCode('PASSWORD_RESET'))
  router.post('/admin/reset-invitations', requireSession, requireRole('ADMIN'), limit(20), requestCode('PASSWORD_RESET'))
  router.get('/me', requireSession, (_request, response) => response.json({ account: response.locals.account }))
  router.post('/logout', requireSession, async (_request, response) => {
    await database.session.updateMany({
      where: { id: response.locals.sessionId, revokedAt: null }, data: { revokedAt: new Date() },
    })
    response.clearCookie(cookieName, cookie).sendStatus(204)
  })

  router.post('/admin/invitations', requireSession, requireRole('ADMIN'), limit(30), async (request, response) => {
    const input = phoneInput.safeParse(request.body)
    if (!input.success) { response.status(400).json({ error: invalidInput }); return }
    const { phone: number } = input.data
    const account = await database.user.upsert({
      where: { phone: number }, create: { phone: number, role: 'MEMBER' }, update: {},
    })
    if (account.role !== 'MEMBER' || !account.active || account.passwordHash) {
      response.status(409).json({ error: 'That number cannot be invited.' })
      return
    }
    let status = 'SMS unavailable. The member can request setup once verification is configured.'
    if (options.sms) {
      try {
        await sendCode(account.id, account.phone, 'SETUP')
        status = 'The account is pending setup. Check the registered phone for the verification code.'
      } catch { status = 'The account is pending setup. SMS delivery could not be started.' }
    }
    response.status(202).json({ message: status })
  })

  return { router, requireSession, requireRole }
}
