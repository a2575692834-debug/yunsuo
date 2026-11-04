import express, { Router } from 'express'
import { authRequired } from '../auth.js'
import {
  deleteResourcesForSavedPath,
  getAccount,
  getResourceForUser
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
    const resourceId = String(req.body?.resourceId || '').trim()
    if (!resourceId) return res.status(400).json({ error: '缺少要下架的 resourceId' })

    const resource = await getResourceForUser(req.user.uid, resourceId)
    if (!resource) return res.status(404).json({ error: '资源记录不存在或已下架' })
    if (!['baidu', 'quark'].includes(resource.provider)) {
      return res.status(400).json({ error: '批量下架目前只支持百度网盘和夸克网盘' })
    }
    if (!resource.savedPath) return res.status(400).json({ error: '资源记录缺少网盘保存路径' })

    const account = await getAccount(req.user.uid, resource.accountId)
    if (!account) return res.status(404).json({ error: '资源绑定的网盘账号不存在' })
    if (account.provider !== resource.provider) {
      return res.status(400).json({ error: '资源与网盘账号类型不一致' })
    }

    const provider = getProvider(resource.provider)
    await provider.remove(account, [resource.savedPath])
    const removedRecords = await deleteResourcesForSavedPath(req.user.uid, resource)

    res.json({
      ok: true,
      resourceId: resource.id,
      provider: resource.provider,
      title: resource.title || resource.savedPath.split('/').pop() || '未命名文件',
      savedPath: resource.savedPath,
      removedRecords
    })
  } catch (err) {
    next(err)
  }
})
