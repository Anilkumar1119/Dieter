import { execFileSync } from 'node:child_process'
import { cp } from 'node:fs/promises'

const run = (script) => execFileSync('npm', ['run', script], { stdio: 'inherit' })
run('build')
if (process.env.VERCEL_ENV === 'production') {
  if (!process.env.DATABASE_URL || !process.env.DIRECT_DATABASE_URL) {
    throw new Error('Configure the pooled and direct Neon URLs before deploying production.')
  }
  run('db:deploy')
}
await cp('web/dist', 'public', { recursive: true })
