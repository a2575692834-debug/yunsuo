import { Router } from 'express'
import { authRequired } from '../auth.js'
import { parseMany, parseOne } from '../utils/parse.js'
import { listAccounts, getAccount, insertResource, insertShare, newId } from '../db.js'
import { getProvider } from '../providers/index.js'
import { queue, animatedProgress } from '../queue.js'
import { resolveShareExpiry, resolveSharePasscode } from '../utils/share.js'

export const transferRouter = Router()
transferRouter.use(authRequired)

function defaultTargetPath() {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `/转存/${value.year}-${value.month}-${value.day}`
}

function normalizeTargetPath(value) {
  let path = String(value || defaultTargetPath()).trim().replace(/\\/g, '/')
  if (!path) path = '/'
  if (!path.startsWith('/')) path = '/' + path
  path = path.replace(/\/+/g, '/').replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts.includes('..') || /[\0:*?"<>|]/.test(path)) return null
  return (path || '/').slice(0, 200)
}

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
      const account = fixedAccount || accounts.find((a) => a.provider === link.provider)
      if (!account) {
        skipped.push({ url: link.url, reason: `还没有添加 ${link.providerName} 账号` })
        continue
      }
      const provider = getProvider(account.provider)
      const passcode = resolveSharePasscode(requestedPasscode, account.provider)
      const task = await queue.add(
        req.user.uid,
        'transfer',
        `${link.providerName} · ${link.key}`,
        {
          batchId,
          accountId: account.id,
          provider: account.provider,
          url: link.url,
          targetPath,
          autoShare
        },
        async (api) => {
          await api.log(`识别为 ${link.providerName} 分享`)
          await animatedProgress(api, async () => {
            const saved = await provider.transfer(account, link, link.passcode, targetPath)
            const sourceName = String(saved.sourceName || link.key).slice(0, 180)
            await api.rename(`${link.providerName} · ${sourceName}`)
            await api.log(`转存完成${saved.savedPaths?.length ? ' → ' + saved.savedPaths.join(', ') : ''}`)
            await insertResource({
              id: newId('res'),
              userId: req.user.uid,
              accountId: account.id,
              provider: account.provider,
              title: sourceName,
              sourceUrl: link.url,
              sourceCode: link.passcode || '',
              savedPath: saved.savedPaths?.[0] || targetPath,
              taskId: api.taskId,
              batchId,
              createdAt: Date.now()
            })

            if (autoShare) {
              await api.log('正在创建分享链接…')
              const paths = saved.savedPaths?.length ? saved.savedPaths : [targetPath]
              const shared = await provider.share(account, paths, {
                unlimited,
                expires,
                passcode,
                title: sourceName,
                fids: saved.savedFids || []
              })
              const record = await insertShare({
                id: newId('share'),
                userId: req.user.uid,
                accountId: account.id,
                provider: account.provider,
                batchId,
                taskId: api.taskId,
                title: sourceName,
                url: shared.url,
                passcode: shared.passcode,
                expires: shared.expires ?? expires,
                createdAt: Date.now()
              })
              await api.log(`分享已生成${record.passcode ? ` · 提取码 ${record.passcode}` : ''}: ${record.url}`)
            }
          })
        }
      )
      tasks.push(task.id)
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
