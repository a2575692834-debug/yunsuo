import { Router } from 'express'
import { authRequired } from '../auth.js'
import { getAccount } from '../db.js'
import { getProvider } from '../providers/index.js'
import { enqueueCloudSync, validateCloudSyncPair } from '../services/cloud-sync.js'
import { normalizeTargetPath } from '../utils/path.js'

export const cloudSyncRouter = Router()
cloudSyncRouter.use(authRequired)

function normalizeSourcePath(value) {
  let path = String(value || '').trim().replace(/\\/g, '/')
  if (!path.startsWith('/')) path = '/' + path
  path = path.replace(/\/+/g, '/').replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  if (
    !path ||
    path === '/' ||
    path.length > 200 ||
    path.includes('\0') ||
    parts.some((part) => part === '.' || part === '..')
  ) {
    return null
  }
  return path
}

cloudSyncRouter.post('/sync', async (req, res, next) => {
  try {
    const sourceAccount = await getAccount(req.user.uid, String(req.body?.sourceAccountId || ''))
    const destinationAccount = await getAccount(req.user.uid, String(req.body?.destinationAccountId || ''))
    validateCloudSyncPair(sourceAccount, destinationAccount)
    const sourcePath = normalizeSourcePath(req.body?.sourcePath)
    const destinationPath = normalizeTargetPath(
      String(req.body?.destinationPath || '').trim() || '/'
    )

    if (!sourcePath) return res.status(400).json({ error: '请选择要同步的文件或文件夹' })
    if (!destinationPath) return res.status(400).json({ error: '目标目录包含不支持的字符' })

    const sourceProvider = getProvider(sourceAccount.provider)
    const parentPath = sourcePath.split('/').slice(0, -1).join('/') || '/'
    const sourceName = sourcePath.split('/').pop()
    const rows = await sourceProvider.list(sourceAccount, parentPath)
    const sourceItem = rows.find((item) => item.name === sourceName)
    if (!sourceItem) return res.status(404).json({ error: '源网盘中的文件或文件夹不存在' })

    const queued = await enqueueCloudSync({
      userId: req.user.uid,
      sourceAccount,
      destinationAccount,
      sourcePath,
      sourceName: sourceItem.name,
      destinationPath
    })
    res.json({
      ...queued,
      sourceItem: {
        name: sourceItem.name,
        type: sourceItem.type,
        size: sourceItem.size
      }
    })
  } catch (err) {
    next(err)
  }
})
