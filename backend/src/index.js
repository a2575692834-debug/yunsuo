import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { config } from './config.js'
import { initDb, closeDb, createUser, findUserByName, setAdmin } from './db.js'
import { queue } from './queue.js'
import { authRouter } from './routes/auth.js'
import { providersRouter } from './routes/providers.js'
import { accountsRouter } from './routes/accounts.js'
import { transferRouter } from './routes/transfer.js'
import { tasksRouter } from './routes/tasks.js'
import { sharesRouter } from './routes/shares.js'
import { overviewRouter } from './routes/overview.js'
import { adminRouter } from './routes/admin.js'
import { searchRouter } from './routes/search.js'
import { publicRouter } from './routes/public.js'
import { monitorsRouter } from './routes/monitors.js'
import { monitorScheduler } from './monitor-scheduler.js'

const app = express()
app.use(cors({ origin: true }))
app.use(express.json({ limit: '8mb' }))

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'yunsuo' }))
app.use('/api/auth', authRouter)
app.use('/api/providers', providersRouter)
app.use('/api/accounts', accountsRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/overview', overviewRouter)
app.use('/api/admin', adminRouter)
app.use('/api/search', searchRouter)
app.use('/api/public', publicRouter)
app.use('/api/monitors', monitorsRouter)
app.use('/api', transferRouter)
app.use('/api', sharesRouter)

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  const status = err.status && Number.isInteger(err.status) ? err.status : (err.statusCode || 500)
  if (status >= 500) console.error(err)
  res.status(status).json({ error: err.message || '服务器内部错误' })
})

async function ensureAdminAccount() {
  const { username, password } = config.admin
  if (!username || !password) return
  const existing = await findUserByName(username)
  if (existing) {
    const matches = await bcrypt.compare(password, existing.password_hash)
    if (!matches) {
      console.warn(`[yunsuo] ADMIN_USERNAME=${username} 已存在但密码与 ADMIN_PASSWORD 不匹配，未提升权限`)
      return
    }
    if (!existing.is_admin) await setAdmin(existing.id, true)
    return
  }
  await createUser(username, await bcrypt.hash(password, 10), true)
  console.log(`[yunsuo] admin account ready: ${username}`)
}

await initDb()
await ensureAdminAccount()
await queue.restore()
monitorScheduler.start()
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[yunsuo] listening on :${config.port}`)
})

async function shutdown() {
  server.close(async () => {
    monitorScheduler.stop()
    await closeDb()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
