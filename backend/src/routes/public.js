import { Router } from 'express'
import { findUserByName, listPublicResources } from '../db.js'

export const publicRouter = Router()

async function publicOwner(username) {
  const owner = await findUserByName(String(username || ''))
  return owner?.public_transfers ? owner : null
}

function pageParams(query) {
  const page = Number.parseInt(query.page, 10)
  const pageSize = Number.parseInt(query.pageSize, 10)
  return {
    page: Number.isFinite(page) ? Math.max(1, page) : 1,
    pageSize: Number.isFinite(pageSize) ? Math.max(1, Math.min(100, pageSize)) : 20
  }
}

publicRouter.get('/resources', async (req, res, next) => {
  try {
    const { page, pageSize } = pageParams(req.query)
    const keyword = String(req.query.q || '').trim().slice(0, 100)
    const provider = String(req.query.provider || '').trim().slice(0, 20)
    const result = await listPublicResources({ keyword, provider, page, pageSize })
    res.set('Cache-Control', 'no-store, max-age=0')
    res.json({
      items: result.items,
      total: result.total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(result.total / pageSize))
    })
  } catch (err) { next(err) }
})

publicRouter.get('/users/:username', async (req, res, next) => {
  try {
    const owner = await publicOwner(req.params.username)
    if (!owner) return res.status(404).json({ error: '公开主页不存在或未开启' })
    const result = await listPublicResources({ username: owner.username, page: 1, pageSize: 1 })
    res.set('Cache-Control', 'no-store, max-age=0')
    res.json({
      user: {
        username: owner.username,
        total: result.total
      }
    })
  } catch (err) { next(err) }
})

publicRouter.get('/users/:username/resources', async (req, res, next) => {
  try {
    const owner = await publicOwner(req.params.username)
    if (!owner) return res.status(404).json({ error: '公开主页不存在或未开启' })
    const { page, pageSize } = pageParams(req.query)
    const keyword = String(req.query.q || '').trim().slice(0, 100)
    const provider = String(req.query.provider || '').trim().slice(0, 20)
    const result = await listPublicResources({
      username: owner.username,
      keyword,
      provider,
      page,
      pageSize
    })
    res.set('Cache-Control', 'no-store, max-age=0')
    res.json({
      user: { username: owner.username },
      items: result.items,
      total: result.total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(result.total / pageSize))
    })
  } catch (err) { next(err) }
})
