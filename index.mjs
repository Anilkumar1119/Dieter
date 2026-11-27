import express from 'express'
import app from './backend/dist/app.js'

export default express().disable('x-powered-by').use(app)
