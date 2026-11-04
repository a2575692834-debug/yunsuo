import express, { Router } from 'express'
import { authRequired } from '../auth.js'
import {
  deleteResourcesForSavedPath,
  getAccount
} from '../db.js'
import { getProvider } from '../providers/index.js'
import {
  buildDelistPreview,
  extractShareLinks,
  parseXlsxWorkbook
} from '../services/delist.js'

export const delistRouter = Router()
delistRouter.use(authRequired)

const rawWorkbook = express.raw({
  type: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ],
  limit: '12mb'
})

delistRouter.post('/preview', rawWorkbook, async (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: '请上传 XLSX 文件' })
    }
    const workbook = parseXlsxWorkbook(req.body)
    const parsed = extractShareLinks(workbook)
    if (!parsed.links.length) {
      return res.status(400).json({ error: '表格里没有识别到百度或夸克网盘分享链接' })
    }
    const encodedName = String(req.headers['x-file-name'] || '')
    let fileName = encodedName
    try {
      fileName = encodedName ? decodeURIComponent(encodedName) : ''
    } catch {
      fileName = encodedName
    }
    res.json({
      fileName: fileName.slice(0, 180),
      ...(await buildDelistPreview(req.user.uid, parsed))
    })
  } catch (err) {
    next(err)
  }
})

delistRouter.post('/execute', async (req, res, next) => {
  try {
    const accountId = String(req.body?.accountId || '').trim()
    let path = String(req.body?.path || '').trim().replace(/\\/g, '/')
    if (!accountId) return res.status(400).json({ error: '缺少要下架的网盘账号' })
    if (!path) return res.status(400).json({ error: '缺少要下架的网盘路径' })
    if (!path.startsWith('/')) path = '/' + path
    path = path.replace(/\/+/g, '/').replace(/\/+$/, '')
    if (!path || path === '/' || path.includes('\0') || path.split('/').some((part) => part === '.' || part === '..')) {
      return res.status(400).json({ error: '网盘路径不合法' })
    }

    const account = await getAccount(req.user.uid, accountId)
    if (!account) return res.status(404).json({ error: '网盘账号不存在' })
    if (!['baidu', 'quark'].includes(account.provider)) {
      return res.status(400).json({ error: '批量下架目前只支持百度网盘和夸克网盘' })
    }

    const provider = getProvider(account.provider)
    await provider.remove(account, [path])
    const removedRecords = await deleteResourcesForSavedPath(req.user.uid, {
      accountId: account.id,
      provider: account.provider,
      savedPath: path
    })

    res.json({
      ok: true,
      accountId: account.id,
      provider: account.provider,
      title: path.split('/').pop() || '未命名文件',
      path,
      removedRecords
    })
  } catch (err) {
    next(err)
  }
})
