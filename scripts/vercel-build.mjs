import { execFileSync } from 'node:child_process'
import { cp, readdir, readFile, writeFile } from 'node:fs/promises'

const run = (script) => execFileSync('npm', ['run', script], { stdio: 'inherit' })
run('build')
if (process.env.VERCEL_ENV === 'production') {
  if (!process.env.DATABASE_URL || !process.env.DIRECT_DATABASE_URL) {
    throw new Error('Configure the pooled and direct Neon URLs before deploying production.')
  }
  run('db:deploy')
}
await cp('web/dist', 'public', { recursive: true })

// Keep the shell and Vite's text assets available to the Express function
// when Vercel routes the request there instead of serving it from the CDN.
const assets = await readdir('web/dist/assets', { withFileTypes: true })
const webPaths = ['index.html', ...assets.filter((asset) => asset.isFile() && /\.(?:css|js)$/.test(asset.name))
  .map((asset) => 'assets/' + asset.name)]
const webFiles = Object.fromEntries(await Promise.all(webPaths.map(async (path) =>
  [path, await readFile('web/dist/' + path, 'utf8')],
)))
await writeFile('backend/dist/vercel-web.js', 'export const webFiles = ' + JSON.stringify(webFiles) + '\n')
