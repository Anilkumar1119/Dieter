import NotificationBell from './NotificationBell'
import { useState } from 'react'
import { balance, Bills, dateLabel, Feedback, feeStatus, inr, PageFrame, panel, planTerm, Status, useResource, type Bill, type BillHistory, type Profile } from './shared'

export default function MemberDashboard({ onLogout, loggingOut, error }: { onLogout: () => void; loggingOut: boolean; error: string }) {
  const [billPage, setBillPage] = useState(1)
  const result = useResource<BillHistory & { profile: Profile | null; openBill: Bill | null; today: string }>('/member/dashboard?billPage=' + billPage)
  const data = result.data
  const profile = data?.profile
  const membership = profile?.membership
  const open = data?.openBill
  return <PageFrame notificationBell={<NotificationBell role="member" />} title={profile ? profile.fullName : 'My membership'} label="Member dashboard" onLogout={onLogout} loggingOut={loggingOut}>
    <Feedback error={error || result.error} loading={result.loading} />
    {data && !profile && <p className={panel}>Your account is ready. Ask the gym to add your membership details.</p>}
    {data && profile && <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <section className={panel}><h2 className="text-sm font-semibold text-slate-700">Current plan</h2>
          <p className="mt-2 text-xl font-semibold">{membership?.currentPlan.name ?? 'No plan assigned'}</p>
          {membership && <p className="mt-1 text-slate-700">{inr(membership.currentPlan.amountPaise)} · {planTerm(membership.currentPlan.intervalMonths)}</p>}
          {membership?.pendingPlan && <p className="mt-2 text-sm text-slate-700">{membership.pendingPlan.name} starts at the next renewal.</p>}
        </section>
        <section className={panel}><h2 className="text-sm font-semibold text-slate-700">Next renewal</h2>
          <p className="mt-2 text-xl font-semibold">{membership?.nextBillingDate ? dateLabel(membership.nextBillingDate) : 'Unavailable'}</p>
          <p className="mt-1 text-slate-700">Admitted {dateLabel(profile.admissionDate)}</p>
        </section>
        <section className={panel}><h2 className="text-sm font-semibold text-slate-700">Oldest unpaid bill</h2>
          {open ? <><p className="mt-2 text-xl font-semibold">{inr(balance(open))}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2"><Status>{feeStatus(open, data.today)}</Status><span>{dateLabel(open.dueDate)}</span></div>
          </> : <p className="mt-2 text-xl font-semibold">{membership ? 'No open bills' : 'Unavailable'}</p>}
        </section>
      </div>
      <section className={panel}><h2 className="text-lg font-semibold">Profile</h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          <div><dt className="text-sm text-slate-700">Age</dt><dd>{profile.age}</dd></div>
          <div><dt className="text-sm text-slate-700">Mobile number</dt><dd>{profile.user.phone}</dd></div>
          <div className="min-w-0"><dt className="text-sm text-slate-700">Email</dt><dd className="break-all">{profile.email || 'No email added'}</dd></div>
        </dl>
      </section>
      <Bills history={data} today={data.today} onChange={setBillPage} role="member" />
    </div>}
  </PageFrame>
}
