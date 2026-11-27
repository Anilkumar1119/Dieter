import { useEffect, useRef, useState, type FormEvent } from 'react'

const field = 'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950'
type SetupStatus = 'loading' | 'available' | 'unconfigured' | 'closed' | 'failed' | 'created'

export default function AdminSetup() {
  const [status, setStatus] = useState<SetupStatus>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const request = new AbortController()
    void (async () => {
      try {
        const response = await fetch('/api/auth/admin/setup', { signal: request.signal })
        if (!response.ok) throw new Error('Admin setup could not be loaded.')
        const result: { status: 'available' | 'unconfigured' | 'closed' } = await response.json()
        if (!request.signal.aborted) setStatus(result.status)
      } catch {
        if (!request.signal.aborted) setStatus('failed')
      }
    })()
    return () => request.abort()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setError('')
    if (data.get('password') !== data.get('confirmPassword')) {
      setError('The passwords don’t match.')
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/auth/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: data.get('phone'),
          token: String(data.get('token') ?? '').trim(),
          password: data.get('password'),
        }),
      })
      const result: { error?: string } = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'The admin account could not be created.')
      form.current?.reset()
      setStatus('created')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-5 py-10">
      <section className="w-full rounded-3xl border border-emerald-900/15 bg-white p-6 shadow-sm sm:p-10">
        <p className="mb-3 font-semibold text-emerald-800">Gym Member Management</p>
        <h1 className="text-3xl font-semibold tracking-tight text-emerald-950 sm:text-4xl">Create the first admin account</h1>
        {status === 'loading' && <p className="mt-4" role="status">Checking setup availability…</p>}
        {status === 'closed' && <p className="mt-4" role="status">An admin account already exists. First admin setup is closed.</p>}
        {status === 'unconfigured' && <p className="mt-4" role="status">Set <code>ADMIN_SETUP_TOKEN</code> in the site’s production environment and redeploy to open this form.</p>}
        {status === 'failed' && <p className="mt-4 text-red-900" role="alert">Admin setup couldn’t be loaded. Refresh the page and try again.</p>}
        {status === 'created' && <p className="mt-4" role="status">Admin account created. Sign in with your mobile number and new password.</p>}
        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-red-900" role="alert">{error}</p>}
        {status === 'available' && (
          <form ref={form} onSubmit={(event) => void submit(event)} className="mt-6 space-y-5">
            <label className="block font-medium">Admin mobile number
              <input className={field} name="phone" type="tel" autoComplete="username" placeholder="+91 98765 43210" maxLength={32} required />
            </label>
            <label className="block font-medium">Private setup token
              <input className={field} name="token" type="password" autoComplete="off" pattern="[0-9a-fA-F]{64}" minLength={64} maxLength={64} required />
            </label>
            <label className="block font-medium">New password
              <input className={field} name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required />
              <small className="mt-2 block text-sm text-slate-700">Use at least 12 characters.</small>
            </label>
            <label className="block font-medium">Confirm password
              <input className={field} name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={72} required />
            </label>
            <button className="rounded-xl bg-emerald-900 px-5 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create admin account'}</button>
          </form>
        )}
        <a href="/admin/login" className="mt-6 inline-block font-medium text-emerald-900 underline">Admin sign in</a>
      </section>
    </main>
  )
}
