export interface EmailVerification {
  send(input: { to: string; code: string; requestId: string }): Promise<void>
}

export function createEmailVerification(): EmailVerification | undefined {
  const { RESEND_API_KEY, RESEND_FROM_EMAIL } = process.env
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return

  return {
    async send({ to, code, requestId }) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + RESEND_API_KEY,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'dieter-otp/' + requestId,
        },
        body: JSON.stringify({
          from: RESEND_FROM_EMAIL,
          to: [to],
          subject: 'Your Dieter sign-in code',
          text: 'Enter this code to sign in to Dieter: ' + code +
            '\n\nThe code expires in 10 minutes. If you did not request it, you can ignore this email.',
        }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw new Error('Email delivery was rejected.')
    },
  }
}
