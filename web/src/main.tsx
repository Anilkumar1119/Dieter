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

const adminSignIn = window.location.pathname === '/admin/login'
const fieldClass = 'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950'
const buttonClass = 'rounded-xl bg-emerald-900 px-5 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50'

function App() {
  const [account, setAccount] = useState<Account>()
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

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

  async function requestCode() {
    const result = await request('/member/code/request', { email })
    setNotice(result.message ?? '')
    setCodeSent(true)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run(async () => {
      if (adminSignIn) {
        const result = await request('/admin/login', { phone: data.get('phone'), password: data.get('password') })
        setAccount(result.account)
      } else if (codeSent) {
        const result = await request('/member/code/verify', { email, code: data.get('code') })
        setAccount(result.account)
      } else {
        await requestCode()
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
          {checking ? 'Checking your session' : adminSignIn ? 'Admin sign in' : 'Member sign in'}
        </h1>
        {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-950">{notice}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-900">{error}</p>}
        {!checking && (
          <>
            <form onSubmit={submit} className="mt-6 space-y-5">
              {adminSignIn ? <>
                <label className="block font-medium">Registered mobile number
                  <input className={fieldClass} name="phone" type="tel" autoComplete="username" placeholder="+91 98765 43210" required />
                </label>
                <label className="block font-medium">Password
                  <input className={fieldClass} name="password" type="password" autoComplete="current-password" maxLength={72} required />
                </label>
              </> : <>
                <p className="text-sm text-slate-700">Use the email address registered with your gym. We’ll email you a six-digit code to sign in.</p>
                <label className="block font-medium">Registered email address
                  <input className={fieldClass} value={email} onChange={(event) => {
                    setEmail(event.target.value)
                    setCodeSent(false)
                    setNotice('')
                    setError('')
                  }} name="email" type="email" autoComplete="email" maxLength={254} disabled={busy} required />
                </label>
                {codeSent && <label className="block font-medium">Email verification code
                  <input className={fieldClass} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
                </label>}
              </>}
              <div className="flex flex-wrap items-center gap-4">
                <button className={buttonClass} type="submit" disabled={busy}>
                  {busy ? 'Please wait…' : adminSignIn ? 'Sign in' : codeSent ? 'Verify and sign in' : 'Email me a code'}
                </button>
                {!adminSignIn && codeSent && <button type="button" disabled={busy}
                  className="font-medium text-emerald-900 underline" onClick={() => void run(requestCode)}>Send another code</button>}
              </div>
            </form>
            <nav aria-label="Account options" className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-emerald-900 underline">
              {adminSignIn ? <a href="/member/login">Member sign in</a> : <a href="/admin/login">Admin sign in</a>}
            </nav>
          </>
        )}
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
