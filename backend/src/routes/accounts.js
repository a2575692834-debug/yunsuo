import { Router } from 'express'
import { authRequired } from '../auth.js'
import { listAccounts, getAccount, insertAccount, updateAccount, deleteAccount, newId } from '../db.js'
import { getProvider } from '../providers/index.js'

export const accountsRouter = Router()
accountsRouter.use(authRequired)

function fail(message) {
  throw Object.assign(new Error(message), { status: 400 })
}

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

function normalizePath(value) {
  let path = String(value || '').trim().replace(/\\/g, '/')
  if (!path.startsWith('/')) path = '/' + path
  path = path.replace(/\/+/g, '/').replace(/\/+$/, '')
  if (!path) path = '/'
  const parts = path.split('/').filter(Boolean)
  if (parts.some((part) => part === '.' || part === '..') || path.includes('\0')) {
    fail('路径包含不支持的字符')
  }
  return path
}

function normalizeName(value) {
  const name = String(value || '').trim()
  if (!name) fail('名称不能为空')
  if (name.length > 180) fail('名称不能超过 180 个字符')
  if (/[\\/:*?"<>|\0]/.test(name) || name === '.' || name === '..') {
    fail('名称包含不支持的字符')
  }
  return name
}

function operationPaths(value) {
  if (!Array.isArray(value)) fail('请选择要操作的文件')
  const paths = [...new Set(value.map(normalizePath))]
  if (!paths.length) fail('请选择要操作的文件')
  if (paths.length > 50) fail('单次最多操作 50 个文件')
  if (paths.includes('/')) fail('不能操作根目录')
  return paths
}

accountsRouter.get('/', async (req, res, next) => {
  try {
    const rows = await listAccounts(req.user.uid)
    const out = []
    const providerCounts = new Map()
    for (const account of rows) {
      let usage = null
      const provider = getProvider(account.provider)
      try {
        if (typeof provider.refreshSession === 'function') {
          const before = account.cookie
          const refreshed = await provider.refreshSession(account)
          if (refreshed?.cookie && refreshed.cookie !== before) {
            account.cookie = refreshed.cookie
            await updateAccount(req.user.uid, account.id, { cookie: refreshed.cookie })
          }
        }
        usage = await provider.usage(account)
      } catch {
        // 单个账号登录态失效时不阻塞其他账号展示。
      }
      const providerIndex = (providerCounts.get(account.provider) || 0) + 1
      providerCounts.set(account.provider, providerIndex)
      out.push({
        ...account,
        cookie: account.cookie ? account.cookie.slice(0, 10) + '…' : '',
        hasCookie: !!account.cookie,
        providerIndex,
        usage
      })
    }
    res.json(out)
  } catch (err) { next(err) }
})

accountsRouter.post('/', async (req, res, next) => {
  try {
    const providerId = String(req.body?.provider || '')
    const provider = getProvider(providerId)
    const cookie = String(req.body?.cookie || '').trim()
    if (!cookie) return res.status(400).json({ error: '请粘贴 Cookie' })
    const rows = await listAccounts(req.user.uid)
    const account = {
      id: newId('acc'),
      userId: req.user.uid,
      provider: provider.id,
      label: uniqueLabel(rows, provider.id, req.body?.label, provider.name),
      cookie,
      createdAt: Date.now()
    }
    await insertAccount(account)
    res.json({ id: account.id })
  } catch (err) { next(err) }
})

accountsRouter.patch('/:id', async (req, res, next) => {
  try {
    const account = await getAccount(req.user.uid, req.params.id)
    if (!account) return res.status(404).json({ error: '账号不存在' })
    let label
    if (req.body?.label !== undefined) {
      const rows = await listAccounts(req.user.uid)
      label = uniqueLabel(rows.filter((row) => row.id !== account.id), account.provider, req.body.label, account.label)
    }
    await updateAccount(req.user.uid, account.id, {
      label,
      cookie: req.body?.cookie !== undefined ? String(req.body.cookie) : undefined
    })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

accountsRouter.delete('/:id', async (req, res, next) => {
  try {
    await deleteAccount(req.user.uid, req.params.id)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

accountsRouter.get('/:id/files', async (req, res, next) => {
  try {
    const account = await getAccount(req.user.uid, req.params.id)
    if (!account) return res.status(404).json({ error: '账号不存在' })
    res.json(await getProvider(account.provider).list(account, String(req.query.path || '/')))
  } catch (err) { next(err) }
})

accountsRouter.post('/:id/files/operate', async (req, res, next) => {
  try {
    const account = await getAccount(req.user.uid, req.params.id)
    if (!account) return res.status(404).json({ error: '账号不存在' })

    const action = String(req.body?.action || '')
    const allowed = new Set(['rename', 'delete', 'copy', 'move', 'mkdir'])
    if (!allowed.has(action)) return res.status(400).json({ error: '不支持的文件操作' })

    const provider = getProvider(account.provider)
    const operations = provider.operations()
    if (operations[action] === false) {
      return res.status(400).json({ error: `${provider.name} 暂不支持此操作` })
    }

    if (action === 'mkdir') {
      const parent = normalizePath(req.body?.destination || '/')
      const name = normalizeName(req.body?.name)
      await provider.mkdir(account, parent, name)
      return res.json({ ok: true, action, affected: 1 })
    }

    const paths = operationPaths(req.body?.paths)
    if (action === 'rename') {
      if (paths.length !== 1) fail('重命名一次只能选择一个项目')
      await provider.rename(account, paths[0], normalizeName(req.body?.name))
      return res.json({ ok: true, action, affected: 1 })
    }

    if (action === 'delete') {
      await provider.remove(account, paths)
      return res.json({ ok: true, action, affected: paths.length })
    }

    const destination = normalizePath(req.body?.destination || '/')
    for (const path of paths) {
      if (destination === path || destination.startsWith(path + '/')) {
        fail('不能将项目复制或移动到自身或其子目录')
      }
      const parent = path.split('/').slice(0, -1).join('/') || '/'
      if (parent === destination) fail('目标目录与源目录相同')
    }

    if (action === 'copy') await provider.copy(account, paths, destination)
    if (action === 'move') await provider.move(account, paths, destination)
    res.json({ ok: true, action, affected: paths.length, destination })
  } catch (err) { next(err) }
})
