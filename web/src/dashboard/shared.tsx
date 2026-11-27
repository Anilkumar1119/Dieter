import { useEffect, useState, type ReactNode } from 'react'

export type Plan = { id: string; name: string; amountPaise: number; intervalMonths: number; active: boolean }
export type Profile = {
  id: string; fullName: string; age: number; email: string | null; admissionDate: string; archivedAt: string | null
  user: { phone: string; active: boolean; phoneVerifiedAt: string | null }
  membership: { nextBillingDate: string; endsOn: string | null; currentPlan: Plan; pendingPlan: Plan | null } | null
}
export type Payment = { id: string; amountPaise: number; method: string; receivedAt: string; receiptNumber: string }
export type Bill = {
  id: string; dueDate: string; periodStart: string; planName: string; amountPaise: number; status: 'OPEN' | 'PAID' | 'VOID'; payments: Payment[]
}
export type BillHistory = { bills: Bill[]; billPage: number; billPages: number; totalBills: number }
export type AdminSummary = {
  today: string; totalMembers: number; pendingBills: number; paidThisMonth: number; upcomingDues: number
  duePage: number; duePages: number; totalDue: number
  due: (Bill & { membership: { member: { id: string; fullName: string } } })[]
}

export const inr = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(paise / 100)
export const dateLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(date))
export const planTerm = (months: number) => ({ 1: 'Monthly', 3: 'Quarterly', 12: 'Annual' })[months] ?? months + ' months'
export const balance = (bill: Bill) => Math.max(0, bill.amountPaise - bill.payments.reduce((sum, payment) => sum + payment.amountPaise, 0))
export const accountStatus = (profile: Profile) => profile.archivedAt ? 'Archived' : !profile.user.active ? 'Disabled' : profile.user.phoneVerifiedAt ? 'Active' : 'Setup pending'
export const feeStatus = (bill: Bill, today?: string) => bill.status === 'PAID' ? 'Paid' : bill.status === 'VOID' ? 'Void'
  : today && bill.dueDate.slice(0, 10) < today.slice(0, 10) ? 'Overdue'
    : today && bill.dueDate.slice(0, 10) === today.slice(0, 10) ? 'Due today' : 'Unpaid'

export const panel = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'
export const primary = 'rounded-lg bg-emerald-800 px-4 py-2.5 font-semibold text-white hover:bg-emerald-900 disabled:opacity-50'
export const secondary = 'rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50'
export const field = 'mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 disabled:bg-slate-100'
export const cell = 'whitespace-nowrap px-3 py-3 text-left'

export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, {
    method, signal,
    ...(method !== 'GET' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) } : {}),
  })
  if (response.status === 204) return undefined as T
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'The request could not be completed.')
  return result as T
}

export function useResource<T>(url: string | null, version = 0) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>()
  const key = JSON.stringify([url, version])
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    api<T>(url, 'GET', undefined, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setState({ key, data }) })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : 'Could not load records.' })
      })
    return () => controller.abort()
  }, [url, key])
  return state?.key === key ? { ...state, loading: false } : { data: undefined, error: undefined, loading: Boolean(url) }
}

export function PageFrame({ title, label, children, onLogout, loggingOut, notificationBell }: {
  title: string; label: string; children: ReactNode; notificationBell?: ReactNode; onLogout: () => void; loggingOut: boolean
}) {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-5 sm:px-8 sm:py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-emerald-950 px-5 py-6 text-white sm:px-8">
        <div>
          <p className="text-sm font-semibold text-emerald-200">{label}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notificationBell}
          <button type="button" className="rounded-lg border border-emerald-300/70 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
            onClick={onLogout} disabled={loggingOut}>{loggingOut ? 'Signing out…' : 'Sign out'}</button>
        </div>
      </header>
      {children}
    </main>
  )
}

export function Status({ children }: { children: string }) {
  const style = ['Paid', 'Active'].includes(children) ? 'bg-emerald-100 text-emerald-950'
    : ['Overdue', 'Disabled'].includes(children) ? 'bg-rose-100 text-rose-950'
      : ['Due today', 'Unpaid', 'Setup pending'].includes(children) ? 'bg-amber-100 text-amber-950' : 'bg-slate-100 text-slate-800'
  return <span className={'inline-block rounded-md px-2.5 py-1 text-sm font-medium ' + style}>{children}</span>
}

export function Feedback({ error, message, loading }: { error?: string; message?: string; loading?: boolean }) {
  if (error) return <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-rose-950">{error}</p>
  if (message) return <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-emerald-950">{message}</p>
  if (loading) return <p role="status" className="my-4 text-slate-700">Loading…</p>
  return null
}

export function Pagination({ current, pages, total, onChange }: {
  current: number; pages: number; total: number; onChange: (page: number) => void
}) {
  if (pages <= 1) return null
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
    <p className="text-sm text-slate-700">{total} bills · Page {current} of {pages}</p>
    <div className="flex gap-2">
      <button type="button" className={secondary} disabled={current <= 1} onClick={() => onChange(current - 1)}>Previous</button>
      <button type="button" className={secondary} disabled={current >= pages} onClick={() => onChange(current + 1)}>Next</button>
    </div>
  </div>
}

export function Bills({ history, today, onChange, role, onRecord }: {
  history: BillHistory; today?: string; onChange: (page: number) => void; role: 'admin' | 'member';
  onRecord?: (bill: Bill) => void;
}) {
  const { bills, billPage, billPages, totalBills } = history
  const payments = bills.flatMap((bill) => bill.payments).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  return (
    <div className="grid gap-5">
      <section className={panel}>
        <h2 className="text-lg font-semibold">Bills</h2>
        {bills.length ? <div className="mt-3 overflow-x-auto"><table aria-label="Recent bills" className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-slate-700">
            {['Plan', 'Due date', 'Amount', 'Status', ...(onRecord ? ['Action'] : [])].map((text) => <th key={text} scope="col" className={cell}>{text}</th>)}
          </tr></thead><tbody>
            {bills.map((bill) => <tr key={bill.id} className="border-b border-slate-100"><td className={cell}>{bill.planName}</td>
              <td className={cell}>{dateLabel(bill.dueDate)}</td><td className={cell}>{inr(bill.amountPaise)}</td>
              <td className={cell}><Status>{feeStatus(bill, today)}</Status></td>
              {onRecord && <td className={cell}>{bill.status === 'OPEN' && balance(bill) > 0 &&
                <button type="button" className={secondary} onClick={() => onRecord(bill)}>Record payment</button>}</td>}
            </tr>)}
          </tbody></table></div> : <p className="mt-3 text-slate-700">No bills on this page.</p>}
        <Pagination current={billPage} pages={billPages} total={totalBills} onChange={onChange} />
      </section>
      <section className={panel}>
        <h2 className="text-lg font-semibold">Payments for these bills</h2>
        {payments.length ? <div className="mt-3 overflow-x-auto"><table aria-label="Payment history" className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-slate-700">
            {['Received', 'Amount', 'Method', 'Receipt'].map((text) => <th key={text} scope="col" className={cell}>{text}</th>)}
          </tr></thead><tbody>
            {payments.map((payment) => <tr key={payment.id} className="border-b border-slate-100">
              <td className={cell}>{dateLabel(payment.receivedAt)}</td><td className={cell}>{inr(payment.amountPaise)}</td>
              <td className={cell}>{({ CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', OFFLINE_UPI: 'Offline UPI', ONLINE_UPI: 'Online UPI' } as Record<string, string>)[payment.method] ?? payment.method}</td><td className={cell}><div className="flex flex-wrap gap-2">
                <a className="font-medium text-emerald-900 underline" href={'/api/' + role + '/payments/' + payment.id + '/receipt'} target="_blank" rel="noreferrer">View receipt</a>
                <a className="text-emerald-900 underline" href={'/api/' + role + '/payments/' + payment.id + '/receipt?download=1'}>Download</a>
              </div><span className="mt-1 block text-xs text-slate-700">{payment.receiptNumber}</span></td>
            </tr>)}
          </tbody></table></div> : <p className="mt-3 text-slate-700">No payments have been recorded.</p>}
      </section>
    </div>
  )
}
