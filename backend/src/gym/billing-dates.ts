const businessDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function gymToday(now = new Date()): Date {
  return new Date(businessDate.format(now) + 'T00:00:00.000Z')
}

export function moveDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
}

export function billingRenewal(from: Date, months: number, anchorDay: number): Date {
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(anchorDay, lastDay)))
}
