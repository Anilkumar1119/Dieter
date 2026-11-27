import NotificationBell from './NotificationBell'
import { useState, type FormEvent } from 'react'
import PaymentForm from './PaymentForm'
import {
  accountStatus, api, balance, Bills, cell, dateLabel, Feedback, feeStatus, field, inr, PageFrame, Pagination, panel, planTerm, primary,
  secondary, Status, useResource, type AdminSummary, type Bill, type BillHistory, type Plan, type Profile,
} from './shared'

type Tab = 'Overview' | 'Members' | 'Fee plans'
type Sort = 'name' | 'admission' | 'phone'
type Filter = { q: string; page: number; sort: Sort; order: 'asc' | 'desc'; status: string }
type MemberList = { records: Profile[]; total: number; page: number; pages: number }

export default function AdminDashboard({ onLogout, loggingOut, error: signOutError }: { onLogout: () => void; loggingOut: boolean; error: string }) {
  const [tab, setTab] = useState<Tab>('Overview')
  const [version, setVersion] = useState(0)
  const [duePage, setDuePage] = useState(1)
  const [billPage, setBillPage] = useState(1)
  const [management, setManagement] = useState<'add' | string | null>(null)
  const [planEditor, setPlanEditor] = useState<'add' | Plan | null>(null)
  const [filter, setFilter] = useState<Filter>({ q: '', page: 1, sort: 'name', order: 'asc', status: 'current' })
  const [busy, setBusy] = useState(false)
  const [paymentBill, setPaymentBill] = useState<Bill | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const summary = useResource<AdminSummary>(tab === 'Overview' ? '/admin/dashboard?duePage=' + duePage : null, version)
  const plans = useResource<{ plans: Plan[] }>(tab !== 'Overview' ? '/admin/plans' : null, version)
  const listUrl = '/admin/members?' + new URLSearchParams({ ...filter, page: String(filter.page) })
  const members = useResource<MemberList>(tab === 'Members' ? listUrl : null, version)
  const record = useResource<BillHistory & { profile: Profile }>(tab === 'Members' && management && management !== 'add'
    ? '/admin/members/' + management + '?billPage=' + billPage : null, version)

  function openMember(id: string) {
    setBillPage(1)
    setManagement(id)
  }

  function switchTab(next: Tab) {
    setTab(next)
    setPaymentBill(null)
    setManagement(null)
    setPlanEditor(null)
    setNotice('')
    setError('')
  }

  async function change(action: () => Promise<string>) {
    setBusy(true)
    setError('')
    setNotice('')
    try { setNotice(await action()); setVersion((current) => current + 1) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Please try again.') }
    finally { setBusy(false) }
  }

  function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const existing = record.data?.profile
    if (existing && form.get('phone') !== existing.user.phone &&
      !window.confirm('Changing the mobile number signs the member out and requires account setup again. Continue?')) return
    const body = {
      fullName: form.get('fullName'), age: Number(form.get('age')), phone: form.get('phone'),
      email: String(form.get('email') ?? '').trim(), admissionDate: form.get('admissionDate'), planId: form.get('planId'),
    }
    void change(async () => {
      if (existing) await api('/admin/members/' + existing.id, 'PATCH', body)
      else {
        const created = await api<{ id: string }>('/admin/members', 'POST', body)
        openMember(created.id)
      }
      return existing ? 'Member updated.' : 'Member added. Send a setup code when they are ready.'
    })
  }

  function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = {
      name: form.get('name'), amountPaise: Math.round(Number(form.get('rupees')) * 100),
      intervalMonths: Number(form.get('intervalMonths')), active: form.get('active') === 'on',
    }
    const existing = typeof planEditor === 'object' ? planEditor : null
    void change(async () => {
      await api(existing ? '/admin/plans/' + existing.id : '/admin/plans', existing ? 'PATCH' : 'POST', body)
      setPlanEditor(null)
      return existing ? 'Fee plan updated.' : 'Fee plan created.'
    })
  }

  function sortBy(sort: Sort) {
    setFilter((value) => ({ ...value, page: 1, sort, order: value.sort === sort && value.order === 'asc' ? 'desc' : 'asc' }))
  }

  function action(profile: Profile, type: 'toggle' | 'archive' | 'delete' | 'invite' | 'reset') {
    const path = '/admin/members/' + profile.id
    if (type === 'archive' && !window.confirm('Archive this member and stop future renewals? Their billing history will be kept.')) return
    if (type === 'delete' && !window.confirm('Permanently delete this member and their sign-in account?')) return
    void change(async () => {
      if (type === 'invite' || type === 'reset') {
        const route = type === 'invite' ? '/auth/admin/invitations' : '/auth/admin/reset-invitations'
        const result = await api<{ message: string }>(route, 'POST', { phone: profile.user.phone })
        return result.message
      }
      if (type === 'toggle') {
        await api(path + '/access', 'PATCH', { active: !profile.user.active })
        return profile.user.active ? 'Member sign-in disabled.' : 'Member sign-in enabled.'
      }
      if (type === 'archive') await api(path + '/archive', 'POST')
      else await api(path, 'DELETE')
      setManagement(null)
      setFilter((value) => ({ ...value, page: 1 }))
      return type === 'archive' ? 'Member archived.' : 'Member deleted.'
    })
  }

  const data = summary.data
  const profile = record.data?.profile
  const selectedPlan = profile?.membership?.pendingPlan ?? profile?.membership?.currentPlan
  const knownPlans = plans.data?.plans ?? []
  const selectablePlans = knownPlans.filter((plan) => plan.active || plan.id === selectedPlan?.id || plan.id === profile?.membership?.currentPlan.id)
  const noBills = record.data !== undefined && record.data.totalBills === 0
  const dateInputDisabled = profile && !noBills
  const editingPlan = typeof planEditor === 'object' ? planEditor : null

  return <PageFrame notificationBell={<NotificationBell role="admin" />} title="Gym management" label="Admin dashboard" onLogout={onLogout} loggingOut={loggingOut}>
    <nav aria-label="Admin sections" className="mb-5 flex flex-wrap gap-2">
      {(['Overview', 'Members', 'Fee plans'] as const).map((item) => <button key={item} type="button"
        className={tab === item ? primary : secondary} aria-pressed={tab === item} disabled={busy} onClick={() => switchTab(item)}>{item}</button>)}
    </nav>
    <Feedback error={error || signOutError} message={notice} />
    {paymentBill && <div className="mb-5">
      <PaymentForm key={paymentBill.id} bill={paymentBill} busy={busy}
        today={data?.today ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}
        onCancel={() => setPaymentBill(null)}
        onSave={(body) => void change(async () => {
          await api('/admin/bills/' + paymentBill.id + '/payments', 'POST', body)
          setPaymentBill(null)
          return 'Payment recorded. The receipt is available in payment history.'
        })} />
    </div>}
    {tab === 'Overview' && <>
      <Feedback error={summary.error} loading={summary.loading} />
      {data && <>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[['Current members', data.totalMembers], ['Members paid this month', data.paidThisMonth],
            ['Open bills', data.pendingBills], ['Members due in 7 days', data.upcomingDues]].map(([label, count]) => (
            <div key={label} className={panel}><p className="text-sm font-medium text-slate-700">{label}</p>
              <p className="mt-2 text-3xl font-semibold text-emerald-950">{count}</p></div>
          ))}
        </div>
        <section className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Due today and overdue</h2>
            <button type="button" className={secondary} disabled={busy} onClick={() => void change(async () => {
              const result = await api<{ bills: number }>('/admin/billing/run', 'POST')
              return result.bills ? 'Bills generated: ' + result.bills + '.' : 'All current bills are up to date.'
            })}>Generate due bills</button>
          </div>
          {!data.due.length ? <p className="mt-3 text-slate-700">No overdue bills or bills due today.</p> :
            <div className="mt-3 overflow-x-auto"><table aria-label="Due and overdue bills" className="w-full text-sm">
              <thead><tr className="border-b border-slate-200">{['Member', 'Due date', 'Balance', 'Status', 'Action'].map((item) => <th className={cell} key={item} scope="col">{item}</th>)}</tr></thead>
              <tbody>{data.due.map((bill) => <tr key={bill.id} className="border-b border-slate-100">
                <td className={cell}><button className="font-medium text-emerald-900 underline" type="button"
                  onClick={() => { switchTab('Members'); openMember(bill.membership.member.id) }}>{bill.membership.member.fullName}</button></td>
                <td className={cell}>{dateLabel(bill.dueDate)}</td><td className={cell}>{inr(balance(bill))}</td>
                <td className={cell}><Status>{feeStatus(bill, data.today)}</Status></td>
                <td className={cell}>{balance(bill) > 0 && <button type="button" className={secondary}
                  disabled={busy} onClick={() => setPaymentBill(bill)}>Record payment</button>}</td>
              </tr>)}</tbody>
            </table></div>}
          <Pagination current={data.duePage} pages={data.duePages} total={data.totalDue} onChange={setDuePage} />
        </section>
      </>}
    </>}
    {tab === 'Members' && <div className="space-y-5">
      <section className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Members</h2>
          <button type="button" className={primary} disabled={busy} onClick={() => setManagement('add')}>Add member</button></div>
        <form className="my-4 flex flex-wrap items-end gap-3" onSubmit={(event) => {
          event.preventDefault()
          const input = new FormData(event.currentTarget)
          setFilter((current) => ({ ...current, q: String(input.get('q')), status: String(input.get('status')), page: 1 }))
        }}>
          <label className="min-w-40 grow text-sm font-medium">Name or phone<input name="q" className={field} defaultValue={filter.q} maxLength={120} /></label>
          <label className="text-sm font-medium">Records<select name="status" className={field} defaultValue={filter.status}>
            <option value="current">Current members</option><option value="archived">Archived members</option><option value="all">All members</option>
          </select></label>
          <button type="submit" className={secondary}>Search</button>
        </form>
        <Feedback error={members.error} loading={members.loading} />
        {members.data && <>
          {members.data.records.length ? <div className="overflow-x-auto"><table aria-label="Member records" className="w-full text-sm">
            <thead><tr className="border-b border-slate-200">
              {([['name', 'Name'], ['phone', 'Mobile number'], ['admission', 'Admission']] as const).map(([sort, label]) => (
                <th key={sort} scope="col" className={cell} aria-sort={filter.sort === sort ? (filter.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="underline decoration-slate-400" onClick={() => sortBy(sort)}>{label}</button>
                </th>))}
              <th scope="col" className={cell}>Plan</th><th scope="col" className={cell}>Sign-in status</th>
            </tr></thead>
            <tbody>{members.data.records.map((row) => <tr key={row.id} className="border-b border-slate-100">
              <td className={cell}><button type="button" className="font-medium text-emerald-900 underline" onClick={() => openMember(row.id)}>{row.fullName}</button></td>
              <td className={cell}>{row.user.phone}</td><td className={cell}>{dateLabel(row.admissionDate)}</td>
              <td className={cell}>{row.membership?.currentPlan.name ?? 'Unassigned'}</td><td className={cell}><Status>{accountStatus(row)}</Status></td>
            </tr>)}</tbody>
          </table></div> : <p className="mt-3 text-slate-700">No members match your search.</p>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700">{members.data.total} results · Page {members.data.page} of {members.data.pages}</p>
            <div className="flex gap-2">
              <button type="button" className={secondary} disabled={filter.page <= 1} onClick={() => setFilter((current) => ({ ...current, page: current.page - 1 }))}>Previous</button>
              <button type="button" className={secondary} disabled={filter.page >= members.data.pages} onClick={() => setFilter((current) => ({ ...current, page: current.page + 1 }))}>Next</button>
            </div>
          </div>
        </>}
      </section>
      {management && <section className={panel} aria-label={management === 'add' ? 'Add member' : 'Member details'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{management === 'add' ? 'Add member' : profile?.fullName ?? 'Member details'}</h2>
          <button type="button" className={secondary} disabled={busy} onClick={() => setManagement(null)}>Close</button>
        </div>
        <Feedback error={record.error || plans.error} loading={record.loading || plans.loading} />
        {profile?.archivedAt && <p className="mt-3">Archived {dateLabel(profile.archivedAt)} · {profile.user.phone}</p>}
        {(management === 'add' || (profile && !profile.archivedAt)) && !plans.loading && <>
          {profile?.membership?.pendingPlan && <p className="mt-3 text-sm text-slate-700">Next renewal changes to {profile.membership.pendingPlan.name}.</p>}
          <form key={management} onSubmit={saveMember} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="font-medium">Full name<input name="fullName" required minLength={2} maxLength={120} className={field} defaultValue={profile?.fullName} /></label>
            <label className="font-medium">Mobile number<input name="phone" type="tel" required className={field} defaultValue={profile?.user.phone} /></label>
            <label className="font-medium">Age<input name="age" type="number" min={1} max={130} required className={field} defaultValue={profile?.age} /></label>
            <label className="font-medium">Email<input name="email" type="email" maxLength={254} className={field} defaultValue={profile?.email ?? ''} /></label>
            <label className="font-medium">Admission date<input name="admissionDate" type="date" min="1900-01-01" max="9998-12-31" required
              readOnly={Boolean(dateInputDisabled)} className={field} defaultValue={profile?.admissionDate.slice(0, 10)} /></label>
            <label className="font-medium">Fee plan<select name="planId" required className={field} defaultValue={selectedPlan?.id ?? ''}>
              <option value="">Select a fee plan</option>{selectablePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {inr(plan.amountPaise)}</option>)}
            </select></label>
            {!selectablePlans.length && <p className="sm:col-span-2">Create an active fee plan before adding a member.</p>}
            <div className="sm:col-span-2"><button type="submit" className={primary} disabled={busy || !selectablePlans.length}>Save member</button></div>
          </form>
        </>}
        {profile && <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          {!profile.archivedAt && <>
            {profile.user.active && !profile.user.phoneVerifiedAt && <button type="button" className={secondary} disabled={busy} onClick={() => action(profile, 'invite')}>Send setup code</button>}
            {profile.user.active && profile.user.phoneVerifiedAt && <button type="button" className={secondary} disabled={busy} onClick={() => action(profile, 'reset')}>Send reset code</button>}
            <button type="button" className={secondary} disabled={busy} onClick={() => action(profile, 'toggle')}>{profile.user.active ? 'Disable sign-in' : 'Enable sign-in'}</button>
            <button type="button" className={secondary} disabled={busy} onClick={() => action(profile, 'archive')}>Archive member</button>
          </>}
          {noBills && <button type="button" className={secondary + ' text-rose-800'} disabled={busy} onClick={() => action(profile, 'delete')}>Delete member</button>}
        </div>}
      </section>}
      {record.data && <Bills history={record.data} onChange={setBillPage} role="admin" onRecord={setPaymentBill} />}
    </div>}
    {tab === 'Fee plans' && <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Fee plans</h2>
        <button type="button" className={primary} disabled={busy} onClick={() => setPlanEditor('add')}>Add plan</button></div>
      <Feedback error={plans.error} loading={plans.loading} />
      {plans.data && (!knownPlans.length ? <p className="mt-3">No fee plans yet.</p> : <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {knownPlans.map((plan) => <li key={plan.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{plan.name}</h3>
            <Status>{plan.active ? 'Active' : 'Archived'}</Status></div>
          <p className="mt-2 text-lg">{inr(plan.amountPaise)} · {planTerm(plan.intervalMonths)}</p>
          <button type="button" className={secondary + ' mt-3'} disabled={busy} onClick={() => setPlanEditor(plan)}>Edit plan</button>
        </li>)}
      </ul>)}
      {planEditor && <div className="mt-5 border-t border-slate-200 pt-5">
        <h3 className="text-lg font-semibold">{editingPlan ? 'Edit fee plan' : 'Add fee plan'}</h3>
        <form key={editingPlan?.id ?? 'add'} onSubmit={savePlan} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="font-medium">Plan name<input name="name" required maxLength={80} className={field} defaultValue={editingPlan?.name} /></label>
          <label className="font-medium">Price in rupees<input name="rupees" type="number" min="0.01" max="21474836.47" step="0.01" required
            className={field} defaultValue={editingPlan ? editingPlan.amountPaise / 100 : undefined} /></label>
          <label className="font-medium">Billing interval<select name="intervalMonths" className={field} defaultValue={editingPlan?.intervalMonths ?? 1}>
            <option value="1">Monthly</option><option value="3">Quarterly</option><option value="12">Annual</option></select></label>
          <label className="flex items-center gap-2 font-medium sm:self-end sm:pb-3"><input name="active" type="checkbox" defaultChecked={editingPlan?.active ?? true} /> Available for assignment</label>
          <div className="flex gap-2 sm:col-span-2"><button type="submit" className={primary} disabled={busy}>Save plan</button>
            <button type="button" className={secondary} onClick={() => setPlanEditor(null)} disabled={busy}>Cancel</button></div>
        </form>
      </div>}
    </section>}
  </PageFrame>
}
