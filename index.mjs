import express from 'express'
import app from './api/dist/app.js'

export default express().disable('x-powered-by').use(app)
