import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { authRequired } from '../auth.js'
import {
  q,
  findUserById,
  listUsersForAdmin,
  updateUserForAdmin,
  deleteUserForAdmin,
  countAdmins,
  listAccountsForAdmin,
  getAccountById,
  updateAccountForAdmin,
  deleteAccountForAdmin,
  deleteResourceForAdmin
} from '../db.js'

export const adminRouter = Router()
adminRouter.use(authRequired)
adminRouter.use(async (req, res, next) => {
  try {
    const user = await findUserById(req.user.uid)
    if (!user?.is_admin) return res.status(403).json({ error: '仅管理员可以访问后台' })
    req.adminUser = user
    next()
  } catch (err) { next(err) }
})

async function count(sql, params = []) {
  const [rows] = await q(sql, params)
  return Number(rows[0]?.n || 0)
}

function pageParams(query) {
  const page = Number.parseInt(query.page, 10)
  const pageSize = Number.parseInt(query.pageSize, 10)
  return {
    page: Number.isFinite(page) ? Math.max(1, page) : 1,
    pageSize: Number.isFinite(pageSize) ? Math.max(10, Math.min(100, pageSize)) : 20
  }
}

function paged(total, page, pageSize) {
  return {
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize))
  }
}

const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  isAdmin: !!user.is_admin,
  createdAt: user.created_at,
  updatedAt: user.updated_at || user.created_at
})

adminRouter.get('/overview', async (req, res, next) => {
  try {
    const since = Date.now() - 24 * 60 * 60 * 1000
    const [users, accounts, transfers, shares, completed, recent, providerRows] = await Promise.all([
      count('SELECT COUNT(*) AS n FROM users'),
      count('SELECT COUNT(*) AS n FROM accounts'),
      count('SELECT COUNT(*) AS n FROM resources'),
      count('SELECT COUNT(*) AS n FROM shares'),
      count("SELECT COUNT(*) AS n FROM tasks WHERE status = 'done'"),
      count('SELECT COUNT(*) AS n FROM resources WHERE created_at >= ?', [since]),
      q('SELECT provider, COUNT(*) AS total FROM resources GROUP BY provider ORDER BY total DESC')
    ])
    res.json({
      stats: { users, accounts, transfers, shares, completed, recent },
      providers: providerRows[0].map((row) => ({
        provider: row.provider || 'unknown',
        total: Number(row.total || 0)
      }))
    })
  } catch (err) { next(err) }
})

adminRouter.get('/users', async (req, res, next) => {
  try {
    const keyword = String(req.query.q || '').trim().slice(0, 80)
    const { page, pageSize } = pageParams(req.query)
    const result = await listUsersForAdmin({ keyword, page, pageSize })
    res.json({
      items: result.items,
      ...paged(result.total, page, pageSize)
    })
  } catch (err) { next(err) }
})

adminRouter.patch('/users/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const target = Number.isSafeInteger(id) ? await findUserById(id) : null
    if (!target) return res.status(404).json({ error: '用户不存在' })

    const patch = {}
    if (req.body?.isAdmin !== undefined) {
      if (typeof req.body.isAdmin !== 'boolean') {
        return res.status(400).json({ error: '管理员状态格式不正确' })
      }
      if (target.id === req.adminUser.id && !req.body.isAdmin) {
        return res.status(400).json({ error: '不能撤销当前登录管理员自己的权限' })
      }
      patch.isAdmin = req.body.isAdmin
    }
    if (req.body?.password !== undefined) {
      const password = String(req.body.password)
      if (password.length < 6 || password.length > 72) {
        return res.status(400).json({ error: '新密码需为 6-72 个字符' })
      }
      patch.passwordHash = await bcrypt.hash(password, 10)
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: '没有需要更新的内容' })
    }

    const updated = await updateUserForAdmin(target.id, patch)
    res.json({ user: publicUser(updated) })
  } catch (err) { next(err) }
})

adminRouter.delete('/users/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const target = Number.isSafeInteger(id) ? await findUserById(id) : null
    if (!target) return res.status(404).json({ error: '用户不存在' })
    if (target.id === req.adminUser.id) {
      return res.status(400).json({ error: '不能删除当前登录的管理员账号' })
    }
    if (target.is_admin && await countAdmins() <= 1) {
      return res.status(400).json({ error: '至少需要保留一个管理员账号' })
    }
    await deleteUserForAdmin(target.id)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

adminRouter.get('/accounts', async (req, res, next) => {
  try {
    const keyword = String(req.query.q || '').trim().slice(0, 80)
    const provider = String(req.query.provider || '').trim().slice(0, 20)
    const { page, pageSize } = pageParams(req.query)
    const result = await listAccountsForAdmin({ keyword, provider, page, pageSize })
    res.json({
      items: result.items,
      ...paged(result.total, page, pageSize)
    })
  } catch (err) { next(err) }
})

adminRouter.get('/accounts/:id/cookie', async (req, res, next) => {
  try {
    const account = await getAccountById(req.params.id)
    if (!account) return res.status(404).json({ error: '网盘账号不存在' })
    if (!account.cookie) return res.status(404).json({ error: '该账号没有保存 Cookie' })
    res.set('Cache-Control', 'no-store, max-age=0')
    res.set('Pragma', 'no-cache')
    res.json({
      cookie: account.cookie,
      updatedAt: account.updatedAt || account.createdAt
    })
  } catch (err) { next(err) }
})

adminRouter.patch('/accounts/:id', async (req, res, next) => {
  try {
    const account = await getAccountById(req.params.id)
    if (!account) return res.status(404).json({ error: '网盘账号不存在' })

    const patch = {}
    if (req.body?.label !== undefined) {
      const label = String(req.body.label).trim()
      if (!label || label.length > 80) {
        return res.status(400).json({ error: '账号备注需为 1-80 个字符' })
      }
      patch.label = label
    }
    if (req.body?.cookie !== undefined) {
      const cookie = String(req.body.cookie).trim()
      if (!cookie) return res.status(400).json({ error: 'Cookie 不能为空' })
      if (cookie.length > 100000) return res.status(400).json({ error: 'Cookie 内容过长' })
      patch.cookie = cookie
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: '没有需要更新的内容' })
    }

    await updateAccountForAdmin(account.id, patch)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

adminRouter.delete('/accounts/:id', async (req, res, next) => {
  try {
    const account = await getAccountById(req.params.id)
    if (!account) return res.status(404).json({ error: '网盘账号不存在' })
    await deleteAccountForAdmin(account.id)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

adminRouter.get('/transfers', async (req, res, next) => {
  try {
    const keyword = String(req.query.q || '').trim().slice(0, 120)
    const provider = String(req.query.provider || '').trim().slice(0, 20)
    const { page, pageSize } = pageParams(req.query)
    const where = []
    const params = []

    if (keyword) {
      const like = `%${keyword}%`
      where.push(`(
        u.username LIKE ? OR r.title LIKE ? OR r.source_url LIKE ? OR
        r.source_code LIKE ? OR r.saved_path LIKE ? OR a.label LIKE ? OR
        r.task_id LIKE ? OR sh.url LIKE ? OR sh.passcode LIKE ?
      )`)
      params.push(like, like, like, like, like, like, like, like, like)
    }
    if (provider) {
      where.push('r.provider = ?')
      params.push(provider)
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const relation = `
      LEFT JOIN shares sh ON sh.id = (
        SELECT s2.id
        FROM shares s2
        WHERE s2.user_id = r.user_id
          AND (
            (r.task_id IS NOT NULL AND s2.task_id = r.task_id)
            OR
            (r.task_id IS NULL AND s2.provider <=> r.provider AND s2.title = r.title)
          )
        ORDER BY s2.created_at DESC
        LIMIT 1
      )`
    const total = await count(
      `SELECT COUNT(*) AS n
       FROM resources r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN accounts a ON a.id = r.account_id
       ${relation}
       ${clause}`,
      params
    )
    const offset = (page - 1) * pageSize
    const [rows] = await q(
      `SELECT
         r.id, r.title, r.provider, r.source_url, r.source_code, r.saved_path,
         r.task_id, r.batch_id, r.created_at,
         u.id AS user_id, u.username,
         a.label AS account_label,
         sh.url AS share_url, sh.passcode AS share_passcode, sh.expires AS share_expires,
         sh.created_at AS share_created_at
       FROM resources r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN accounts a ON a.id = r.account_id
       ${relation}
       ${clause}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        provider: row.provider,
        sourceUrl: row.source_url,
        sourceCode: row.source_code,
        savedPath: row.saved_path,
        taskId: row.task_id,
        batchId: row.batch_id,
        createdAt: row.created_at,
        userId: row.user_id,
        username: row.username,
        accountLabel: row.account_label,
        shareUrl: row.share_url,
        sharePasscode: row.share_passcode,
        shareExpires: row.share_expires,
        shareCreatedAt: row.share_created_at
      })),
      ...paged(total, page, pageSize)
    })
  } catch (err) { next(err) }
})

adminRouter.delete('/transfers/:id', async (req, res, next) => {
  try {
    await deleteResourceForAdmin(String(req.params.id))
    res.json({ ok: true, scope: 'database-record-only' })
  } catch (err) { next(err) }
})
