import { useEffect, useState } from 'react'
import { api, dateLabel, Feedback, panel, secondary, useResource } from './shared'

type Notifications = {
  items: { id: string; message: string; kind: string; createdAt: string; readAt: string | null }[];
  unread: number; page: number; pages: number;
}

export default function NotificationBell({ role }: { role: 'admin' | 'member' }) {
  const [open, setOpen] = useState(false)
  const [version, refresh] = useState(0)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endpoint = '/' + role + '/notifications'
  const result = useResource<Notifications>(endpoint + '?page=' + page, version)
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    const current = result.data
    if (current) setUnread(current.unread)
  }, [result.data])
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !open) refresh((value) => value + 1)
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [open])

  async function mark(path: string) {
    setError('')
    setBusy(true)
    try { await api(endpoint + path, 'PATCH'); refresh((value) => value + 1) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update the notification.') }
    finally { setBusy(false) }
  }

  return <div className="relative">
    <button type="button" aria-expanded={open} aria-controls="gym-notification-center"
      className="flex items-center gap-2 rounded-lg border border-emerald-300/70 px-3 py-2.5 text-white"
      onClick={() => { setOpen(!open); if (!open) refresh((value) => value + 1) }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M18 8a6 6 0 0 0-12 0c0 5-2 6-2 7h16c0-1-2-2-2-7m-8 10a2 2 0 0 0 4 0" />
      </svg>
      <span className="sr-only">Notifications{unread ? ', ' + unread + ' unread' : ''}</span>
      {unread > 0 && <span aria-hidden="true" className="rounded-md bg-emerald-100 px-1.5 text-sm text-emerald-950">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <section id="gym-notification-center" aria-label="Notifications"
      className={panel + ' fixed inset-x-4 top-28 z-10 max-h-[70vh] overflow-auto sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-84 text-slate-950'}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Notifications</h2>
        {unread > 0 && <button type="button" className="text-sm text-emerald-900 underline" disabled={busy}
          onClick={() => void mark('/read-all')}>Mark all read</button>}
      </div>
      <Feedback error={error || result.error} loading={result.loading} />
      {result.data?.items.length === 0 && <p className="text-sm text-slate-700">You have no notifications yet.</p>}
      {result.data && <>
        <ul className="divide-y divide-slate-200">
          {result.data.items.map((item) => <li className="py-3" key={item.id}>
            <p className={item.readAt ? 'text-sm' : 'text-sm font-semibold'}>{item.message}</p>
            <p className="mt-1 text-xs text-slate-700">{dateLabel(item.createdAt)}</p>
            {!item.readAt && <button type="button" className="mt-1 text-sm text-emerald-900 underline" disabled={busy}
              onClick={() => void mark('/' + item.id + '/read')}>Mark read</button>}
          </li>)}
        </ul>
        {result.data.pages > 1 && <div className="mt-3 flex justify-between gap-2">
          <button type="button" className={secondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button type="button" className={secondary} disabled={page >= result.data.pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>}
      </>}
    </section>}
  </div>
}
