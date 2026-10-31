import { Router } from 'express'
import { authRequired } from '../auth.js'
import { listShares, removeShare, listResources, getAccount, insertShare, newId } from '../db.js'
import { getProvider } from '../providers/index.js'
import { resolveShareExpiry } from '../utils/share.js'

export const sharesRouter = Router()
sharesRouter.use(authRequired)

sharesRouter.get('/shares', async (req, res, next) => {
  try {
    res.json(await listShares(req.user.uid, {
      batchId: req.query.batchId ? String(req.query.batchId) : undefined
    }))
  } catch (err) { next(err) }
})

sharesRouter.delete('/shares/:id', async (req, res, next) => {
  try {
    await removeShare(req.user.uid, req.params.id)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

sharesRouter.get('/resources', async (req, res, next) => {
  try { res.json(await listResources(req.user.uid)) } catch (err) { next(err) }
})

sharesRouter.post('/accounts/:id/share', async (req, res, next) => {
  try {
    const account = await getAccount(req.user.uid, req.params.id)
    if (!account) return res.status(404).json({ error: '账号不存在' })
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.map(String) : []
    if (!paths.length) return res.status(400).json({ error: '请选择要分享的文件' })
    const { unlimited, expires } = resolveShareExpiry(req.body)
    const passcode = String(req.body?.passcode || '').trim().toUpperCase()
    if (passcode && !/^[A-Z0-9]{4}$/.test(passcode)) {
      return res.status(400).json({ error: '分享提取码需为 4 位字母或数字' })
    }
    const result = await getProvider(account.provider).share(account, paths, {
      unlimited,
      expires,
      passcode,
      title: String(req.body?.title || paths[0].split('/').pop())
    })
    const share = await insertShare({
      id: newId('share'),
      userId: req.user.uid,
      accountId: account.id,
      provider: account.provider,
      title: paths.join(', ').slice(0, 180),
      url: result.url,
      passcode: result.passcode,
      expires: result.expires ?? expires,
      createdAt: Date.now()
    })
    res.json(share)
  } catch (err) { next(err) }
})
