import { StrictMode, useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import AdminDashboard from './dashboard/AdminDashboard'
import MemberDashboard from './dashboard/MemberDashboard'

type Account = { id: string; role: 'ADMIN' | 'MEMBER'; phone: string }
type Result = { account?: Account; message?: string; error?: string }

async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<Result> {
  const response = await fetch('/api/auth' + path, {
    signal,
    ...(body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  })
  if (response.status === 204) return {}
  if (path === '/me' && response.status === 401) return {}
  const result: Result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Please try again.')
  return result
}

const locationPath = window.location.pathname
const page = locationPath === '/admin/login' ? 'admin'
  : locationPath === '/member/setup' ? 'setup'
    : locationPath === '/member/reset' ? 'reset' : 'member'
const titles = {
  admin: 'Admin sign in', member: 'Member sign in', setup: 'Set up your account', reset: 'Reset your password',
}
const fieldClass = 'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950'
const buttonClass = 'rounded-xl bg-emerald-900 px-5 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50'

function App() {
  const [account, setAccount] = useState<Account>()
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [phone, setPhone] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const verification = page === 'setup' || page === 'reset'

  useEffect(() => {
    const operation = new AbortController()
    request('/me', undefined, operation.signal)
      .then((result) => setAccount(result.account))
      .catch((failure: unknown) => {
        if (!operation.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not check your session.')
      })
      .finally(() => { if (!operation.signal.aborted) setChecking(false) })
    return () => operation.abort()
  }, [])

  async function run(action: () => Promise<void>) {
    setError('')
    setNotice('')
    setBusy(true)
    try { await action() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Please try again.') }
    finally { setBusy(false) }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run(async () => {
      if (verification) {
        if (!codeSent) {
          const result = await request('/' + page + '/request', { phone })
          setNotice(result.message ?? '')
          setCodeSent(true)
        } else {
          await request('/' + page + '/complete', { phone, code: data.get('code'), password: data.get('password') })
          window.location.assign('/member/login?password=saved')
        }
      } else {
        const result = await request('/' + page + '/login', { phone, password: data.get('password') })
        setAccount(result.account)
      }
    })
  }

  if (account) {
    const dashboardProps = { loggingOut: busy, error, onLogout: () => void run(async () => {
      await request('/logout', {})
      setAccount(undefined)
    }) }
    return account.role === 'ADMIN' ? <AdminDashboard {...dashboardProps} /> : <MemberDashboard {...dashboardProps} />
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-5 py-10">
      <section className="w-full rounded-3xl border border-emerald-900/15 bg-white p-6 shadow-sm sm:p-10">
        <p className="mb-3 font-semibold text-emerald-800">Gym Member Management</p>
        <h1 className="text-3xl font-semibold tracking-tight text-emerald-950 sm:text-4xl">
          {checking ? 'Checking your session' : titles[page]}
        </h1>
        {(notice || (!error && new URLSearchParams(window.location.search).get('password') === 'saved')) &&
          <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-950">{notice || 'Password saved. Sign in with your new password.'}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-900">{error}</p>}
        {!checking && (
          <>
            <form onSubmit={submit} className="mt-6 space-y-5">
              {verification && <p className="text-sm text-slate-700">Enter your mobile number to find your account. We’ll send the code to the email address registered with your gym.</p>}
              <label className="block font-medium">Registered mobile number
                <input className={fieldClass} value={phone} onChange={(event) => { setPhone(event.target.value); setCodeSent(false) }}
                  name="phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" required />
              </label>
              {verification && codeSent && (
                <label className="block font-medium">Email verification code
                  <input className={fieldClass} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
                </label>
              )}
              {(!verification || codeSent) && (
                <label className="block font-medium">{verification ? 'New password' : 'Password'}
                  <input className={fieldClass} name="password" type="password" required maxLength={72}
                    minLength={verification ? 12 : undefined} autoComplete={verification ? 'new-password' : 'current-password'} />
                  {verification && <small className="mt-2 block text-sm text-slate-700">Use at least 12 characters.</small>}
                </label>
              )}
              <div className="flex flex-wrap items-center gap-4">
                <button className={buttonClass} type="submit" disabled={busy}>
                  {busy ? 'Please wait…' : !verification ? 'Sign in' : codeSent ? 'Save password' : 'Send verification code'}
                </button>
                {verification && codeSent && <button type="button" disabled={busy} className="font-medium text-emerald-900 underline"
                  onClick={() => void run(async () => { setNotice((await request('/' + page + '/request', { phone })).message ?? '') })}>
                  Send another code
                </button>}
              </div>
            </form>
            <nav aria-label="Account options" className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-emerald-900 underline">
              {page === 'member' ? <><a href="/member/setup">First-time setup</a><a href="/member/reset">Forgot password</a><a href="/admin/login">Admin sign in</a></>
                : <a href="/member/login">Member sign in</a>}
            </nav>
          </>
        )}
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
