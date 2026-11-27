export interface SmsVerification {
  send(phone: string): Promise<string>
  check(reference: string, code: string): Promise<boolean>
}

export function createSmsVerification(): SmsVerification | undefined {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID } = process.env
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) return

  const service = 'https://verify.twilio.com/v2/Services/' + encodeURIComponent(TWILIO_VERIFY_SERVICE_SID)
  const credentials = Buffer.from(TWILIO_ACCOUNT_SID + ':' + TWILIO_AUTH_TOKEN).toString('base64')

  async function post(path: string, fields: Record<string, string>) {
    let response: Response
    try {
      response = await fetch(service + path, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + credentials },
        body: new URLSearchParams(fields),
        signal: AbortSignal.timeout(8_000),
      })
    } catch {
      throw new Error('SMS provider unavailable.')
    }
    if (path === '/VerificationCheck' && [400, 404].includes(response.status)) return null
    if (!response.ok) throw new Error('SMS provider unavailable.')
    return await response.json() as { sid?: string; status?: string }
  }

  return {
    async send(phone) {
      const result = await post('/Verifications', { To: phone, Channel: 'sms' })
      if (!result?.sid || result.status !== 'pending') throw new Error('SMS provider unavailable.')
      return result.sid
    },
    async check(reference, code) {
      return (await post('/VerificationCheck', { VerificationSid: reference, Code: code }))?.status === 'approved'
    },
  }
}
