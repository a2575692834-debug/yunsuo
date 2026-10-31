import { Router } from 'express'
import { authRequired } from '../auth.js'
import { listAccounts } from '../db.js'
import { getProvider } from '../providers/index.js'

export const searchRouter = Router()
searchRouter.use(authRequired)

searchRouter.get('/files', async (req, res, next) => {
  try {
    const keyword = String(req.query.q || '').trim().slice(0, 120)
    if (!keyword) return res.status(400).json({ error: '请输入搜索关键词' })

    const providerFilter = String(req.query.provider || '').trim()
    const accountFilter = String(req.query.accountId || '').trim()
    const limit = Math.max(10, Math.min(100, Number(req.query.limit || 60)))
    const accounts = (await listAccounts(req.user.uid)).filter((account) => (
      (!providerFilter || account.provider === providerFilter) &&
      (!accountFilter || account.id === accountFilter)
    ))

    if (!accounts.length) {
      return res.json({ query: keyword, items: [], errors: [], accounts: 0, providers: [] })
    }

    const results = new Array(accounts.length)
    const errors = []
    let cursor = 0
    const worker = async () => {
      while (cursor < accounts.length) {
        const index = cursor++
        const account = accounts[index]
        const provider = getProvider(account.provider)
        if (!provider.canSearch) {
          results[index] = []
          errors.push({
            accountId: account.id,
            accountLabel: account.label,
            provider: account.provider,
            providerName: provider.name,
            error: `${provider.name} 暂不支持全网盘检索`
          })
          continue
        }
        try {
          const rows = await provider.search(account, keyword, { limit })
          results[index] = (Array.isArray(rows) ? rows : []).map((item) => ({
            accountId: account.id,
            accountLabel: account.label,
            provider: account.provider,
            providerName: provider.name,
            id: String(item.id || ''),
            name: String(item.name || ''),
            path: String(item.path || '/'),
            parentPath: String(item.parentPath || '/'),
            type: item.type === 'dir' ? 'dir' : 'file',
            size: Number(item.size || 0),
            mtime: Number(item.mtime || 0)
          }))
        } catch (err) {
          results[index] = []
          errors.push({
            accountId: account.id,
            accountLabel: account.label,
            provider: account.provider,
            providerName: provider.name,
            error: err.message || '搜索失败'
          })
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(3, accounts.length) }, () => worker()))
    const items = results
      .flat()
      .filter((item) => item.name)
      .sort((a, b) => Number(b.mtime || 0) - Number(a.mtime || 0))
      .slice(0, limit)

    res.json({
      query: keyword,
      items,
      errors,
      accounts: accounts.length,
      providers: [...new Set(accounts.map((account) => account.provider))]
    })
  } catch (err) { next(err) }
})
