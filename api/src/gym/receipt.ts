import type { Response } from 'express'

const esc = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
)
const date = (value: Date) => new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeZone: 'Asia/Kolkata',
}).format(value)
const money = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR',
}).format(paise / 100)
const methods: Record<string, string> = {
  CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', OFFLINE_UPI: 'Offline UPI', ONLINE_UPI: 'Online UPI',
}

export function sendReceipt(response: Response, receipt: {
  id: string; receiptNumber: string; amountPaise: number; method: string; reference: string | null; receivedAt: Date;
  bill: { periodStart: Date; periodEnd: Date; planName: string; membership: { member: { fullName: string } } };
}, download: boolean) {
  const { bill } = receipt
  const periodLastDay = new Date(bill.periodEnd.getTime() - 86400000)
  const fields = [
    ['Receipt number', receipt.receiptNumber],
    ['Member', bill.membership.member.fullName],
    ['Fee plan', bill.planName],
    ['Billing period', date(bill.periodStart) + ' to ' + date(periodLastDay)],
    ['Payment date', date(receipt.receivedAt)],
    ['Payment method', methods[receipt.method] ?? receipt.method],
    ...(receipt.reference ? [['Payment reference', receipt.reference]] : []),
    ['Amount received', money(receipt.amountPaise)],
  ].map(([label, value]) => '<dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd>').join('')
  response.set('Cache-Control', 'private, no-store')
  if (download) response.attachment('gym-receipt-' + receipt.id + '.html')
  response.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
  response.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gym payment receipt</title><style>
body{font:1rem/1.5 system-ui,sans-serif;color:#15352c;background:#eef5f1;margin:0;padding:1rem}
main{max-width:33rem;margin:2rem auto;padding:2rem;background:white;border:1px solid #cbdcd3;border-radius:1rem}
h1{margin-top:0}dl{display:grid;grid-template-columns:minmax(7rem,1fr) 1.5fr;gap:.75rem}
dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}p{color:#37554b}
@media print{body{background:white;padding:0}main{border:0;margin:0;padding:0}p{display:none}}
</style></head><body><main><h1>Payment receipt</h1><dl>${fields}</dl>
<p>Use your browser’s print menu to print or save a PDF copy.</p></main></body></html>`)
}
