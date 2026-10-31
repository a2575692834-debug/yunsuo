import { Router } from 'express'
import { listProviders, getProvider } from '../providers/index.js'
import { authRequired } from '../auth.js'
import { newId, insertAccount, listAccounts } from '../db.js'

export const providersRouter = Router()
const consumed = new Map()

providersRouter.use(authRequired)

function uniqueLabel(rows, providerId, requested, fallback) {
  const base = String(requested || fallback || '').trim().slice(0, 60) || fallback
  const labels = new Set(rows.filter((row) => row.provider === providerId).map((row) => row.label))
  if (!labels.has(base)) return base
  for (let index = 2; index < 100; index++) {
    const candidate = `${base} (${index})`
    if (!labels.has(candidate)) return candidate
  }
  return `${base} (${Date.now().toString(36).slice(-4)})`
}

providersRouter.get('/', (req, res) => {
  res.json(listProviders())
})

providersRouter.post('/:id/qr/start', async (req, res, next) => {
  try {
    res.json(await getProvider(req.params.id).qrStart())
  } catch (err) { next(err) }
})

providersRouter.get('/:id/qr/poll', async (req, res, next) => {
  try {
    const token = String(req.query.token || '')
    const provider = getProvider(req.params.id)
    if (consumed.has(token)) {
      return res.json({ status: 'confirmed', accountId: consumed.get(token) })
    }
    const result = await provider.qrPoll(token)
    if (result.status === 'confirmed' && result.cookie) {
      const rows = await listAccounts(req.user.uid)
      const account = {
        id: newId('acc'),
        userId: req.user.uid,
        provider: provider.id,
        label: uniqueLabel(rows, provider.id, result.label, provider.name),
        cookie: result.cookie,
        createdAt: Date.now()
      }
      await insertAccount(account)
      consumed.set(token, account.id)
      return res.json({ status: 'confirmed', accountId: account.id })
    }
    res.json(result)
  } catch (err) { next(err) }
})
