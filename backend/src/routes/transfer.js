import { Router } from 'express'
import { authRequired } from '../auth.js'
import { parseMany, parseOne } from '../utils/parse.js'
import { listAccounts, getAccount, newId } from '../db.js'
import { getProvider } from '../providers/index.js'
import { queue, animatedProgress } from '../queue.js'
import { resolveShareExpiry, resolveSharePasscode } from '../utils/share.js'
import { defaultTargetPath, normalizeTargetPath } from '../utils/path.js'
import { enqueueTransfer } from '../services/transfer-runner.js'

export const transferRouter = Router()
transferRouter.use(authRequired)

transferRouter.post('/parse', (req, res) => {
  const text = String(req.body?.text || '')
  const links = parseMany(text)
  if (!links.length) return res.status(400).json({ error: '没有识别到百度 / 夸克 / 迅雷分享链接' })
  res.json({ links })
})

transferRouter.post('/transfer', async (req, res, next) => {
  try {
    const text = String(req.body?.text || '')
    let links = parseMany(text)
    if (Array.isArray(req.body?.links) && req.body.links.length) {
      links = req.body.links.map((item) => {
        const parsed = parseOne(String(item?.url || ''))
        if (!parsed) return null
        return { ...parsed, passcode: String(item?.passcode || parsed.passcode || '') }
      }).filter(Boolean)
    }
    if (!links.length) return res.status(400).json({ error: '没有识别到可转存的分享链接' })

    const accounts = await listAccounts(req.user.uid)
    const fixedAccount = req.body?.accountId
      ? await getAccount(req.user.uid, String(req.body.accountId))
      : null
    const targetPath = normalizeTargetPath(req.body?.targetPath)
    if (!targetPath) return res.status(400).json({ error: '转存目录包含不支持的字符' })
    const autoShare = req.body?.autoShare !== false
    const { unlimited, expires } = resolveShareExpiry(req.body)
    const requestedPasscode = req.body?.sharePasscode
    if (requestedPasscode !== undefined && requestedPasscode !== '' &&
        !/^[A-Z0-9]{4}$/.test(String(requestedPasscode).trim().toUpperCase())) {
      return res.status(400).json({ error: '分享提取码需为 4 位字母或数字' })
    }

    const batchId = newId('batch')
    const tasks = []
    const skipped = []

    for (const link of links) {
      const account = fixedAccount?.provider === link.provider
        ? fixedAccount
        : accounts.find((a) => a.provider === link.provider)
      if (!account) {
        skipped.push({ url: link.url, reason: `还没有添加 ${link.providerName} 账号` })
        continue
      }
      const passcode = resolveSharePasscode(requestedPasscode, account.provider)
      const queued = await enqueueTransfer({
        userId: req.user.uid,
        account,
        link,
        targetPath,
        autoShare,
        unlimited,
        expires,
        sharePasscode: passcode,
        batchId,
        titlePrefix: link.providerName,
        detail: {}
      })
      tasks.push(queued.task.id)
    }

    res.json({ batchId, tasks, skipped })
  } catch (err) { next(err) }
})

transferRouter.post('/transfer/direct', async (req, res, next) => {
  try {
    const account = await getAccount(req.user.uid, String(req.body?.accountId || ''))
    if (!account) return res.status(404).json({ error: '账号不存在' })
    const link = parseOne(String(req.body?.url || ''))
    if (!link) return res.status(400).json({ error: '链接格式不正确' })
    const targetPath = normalizeTargetPath(req.body?.targetPath)
    if (!targetPath) return res.status(400).json({ error: '转存目录包含不支持的字符' })
    const provider = getProvider(account.provider)
    const task = await queue.add(
      req.user.uid,
      'transfer',
      `${link.providerName} · ${link.key}`,
      { accountId: account.id, provider: account.provider, url: link.url, targetPath },
      async (api) => {
        await animatedProgress(api, async () => {
          await provider.transfer(account, link, link.passcode, targetPath)
          await api.log('转存完成')
        })
      }
    )
    res.json({ taskId: task.id })
  } catch (err) { next(err) }
})
