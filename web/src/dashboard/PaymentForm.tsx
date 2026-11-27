import { useEffect, useRef, useState, type FormEvent } from 'react'
import { balance, field, inr, panel, primary, secondary, type Bill } from './shared'

export default function PaymentForm({ bill, today, busy, onCancel, onSave }: {
  bill: Bill; today: string; busy: boolean; onCancel: () => void;
  onSave: (details: { paymentId: string; method: string; receivedOn: string; reference: string }) => void;
}) {
  const [paymentId] = useState(() => crypto.randomUUID())
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    onSave({
      paymentId, method: String(form.get('method')), receivedOn: String(form.get('receivedOn')),
      reference: String(form.get('reference') ?? '').trim(),
    })
  }

  return <section className={panel} aria-labelledby="payment-heading">
    <h2 ref={heading} tabIndex={-1} id="payment-heading" className="text-xl font-semibold">Record a payment</h2>
    <p className="mt-2 text-slate-700">Outstanding balance · {inr(balance(bill))}</p>
    <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="font-medium">Payment method<select name="method" className={field} required disabled={busy}>
        <option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option>
      </select></label>
      <label className="font-medium">Payment date<input className={field} name="receivedOn" type="date" required disabled={busy}
        defaultValue={today.slice(0, 10)} max={today.slice(0, 10)} min={bill.periodStart.slice(0, 10)} /></label>
      <label className="font-medium sm:col-span-2">Reference <span className="font-normal text-slate-600">(optional)</span>
        <input className={field} name="reference" maxLength={120} disabled={busy} /></label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button className={primary} type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record full balance'}</button>
        <button className={secondary} type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  </section>
}
