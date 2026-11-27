import express from 'express'
import helmet from 'helmet'
import app from './backend/dist/app.js'
import { webFiles } from './backend/dist/vercel-web.js'

const entry = express().disable('x-powered-by')
const browserHeaders = helmet()
const pages = ['/', '/index.html', '/admin/login', '/admin/setup', '/member/login', '/member/setup', '/member/reset']

entry.get(pages, browserHeaders, (_request, response) => {
  response.type('html').set('Cache-Control', 'no-cache').send(webFiles['index.html'])
})

entry.get('/assets/:name', browserHeaders, (request, response, next) => {
  const path = 'assets/' + request.params.name
  if (!Object.hasOwn(webFiles, path)) { next(); return }
  response.type(request.params.name)
    .set('Cache-Control', 'public, max-age=31536000, immutable')
    .send(webFiles[path])
})

export default entry.use(app)
