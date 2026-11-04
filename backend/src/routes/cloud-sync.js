import { Router } from 'express'
import { authRequired } from '../auth.js'
import {
  claimCloudSyncSchedule,
  deleteCloudSyncSchedule,
  getAccount,
  getCloudSyncSchedule,
  insertCloudSyncSchedule,
  listCloudSyncSchedules,
  newId,
  releaseCloudSyncScheduleLock,
  updateCloudSyncSchedule
} from '../db.js'
import { getProvider } from '../providers/index.js'
import {
  enqueueCloudSync,
  enqueueCloudSyncPair,
  validateCloudSyncPair
} from '../services/cloud-sync.js'
import { normalizeTargetPath } from '../utils/path.js'

export const cloudSyncRouter = Router()
cloudSyncRouter.use(authRequired)

const SCHEDULE_INTERVAL_HOURS = 24
const SCHEDULE_INTERVAL_MS = SCHEDULE_INTERVAL_HOURS * 60 * 60 * 1000

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

async function loadScheduleAccounts(body) {
  const baiduAccount = await getAccount(
    body.userId,
    String(body.baiduAccountId || '')
  )
  const quarkAccount = await getAccount(
    body.userId,
    String(body.quarkAccountId || '')
  )
  validateCloudSyncPair(baiduAccount, quarkAccount)
  if (baiduAccount.provider !== 'baidu' || quarkAccount.provider !== 'quark') {
    throw Object.assign(new Error('双向同步需要分别选择百度网盘和夸克网盘账号'), { status: 400 })
  }
  return { baiduAccount, quarkAccount }
}

async function assertFolder(account, path, label) {
  const provider = getProvider(account.provider)
  try {
    await provider.list(account, path)
  } catch (err) {
    throw Object.assign(
      new Error(`${label}不存在或无法读取：${err.message || '目录读取失败'}`),
      { status: 400 }
    )
  }
}

cloudSyncRouter.get('/schedules', async (req, res, next) => {
  try {
    res.json(await listCloudSyncSchedules(req.user.uid))
  } catch (err) { next(err) }
})

cloudSyncRouter.post('/schedules', async (req, res, next) => {
  try {
    const body = req.body || {}
    const { baiduAccount, quarkAccount } = await loadScheduleAccounts({
      ...body,
      userId: req.user.uid
    })
    const baiduPath = normalizeSourcePath(body.baiduPath)
    const quarkPath = normalizeSourcePath(body.quarkPath)
    if (!baiduPath || !quarkPath) {
      return res.status(400).json({ error: '请选择百度网盘和夸克网盘中的同步文件夹' })
    }

    await Promise.all([
      assertFolder(baiduAccount, baiduPath, '百度同步文件夹'),
      assertFolder(quarkAccount, quarkPath, '夸克同步文件夹')
    ])

    const schedule = {
      id: newId('sync'),
      userId: req.user.uid,
      baiduAccountId: baiduAccount.id,
      baiduPath,
      quarkAccountId: quarkAccount.id,
      quarkPath,
      intervalHours: SCHEDULE_INTERVAL_HOURS,
      enabled: true,
      status: 'waiting',
      nextRunAt: Date.now() + SCHEDULE_INTERVAL_MS
    }
    try {
      await insertCloudSyncSchedule(schedule)
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: '这组双向同步文件夹已经存在' })
      }
      throw err
    }
    res.json(await getCloudSyncSchedule(req.user.uid, schedule.id))
  } catch (err) { next(err) }
})

cloudSyncRouter.patch('/schedules/:id', async (req, res, next) => {
  try {
    const existing = await getCloudSyncSchedule(req.user.uid, req.params.id)
    if (!existing) return res.status(404).json({ error: '双向同步计划不存在' })
    const patch = {}
    if (req.body?.enabled !== undefined) {
      patch.enabled = !!req.body.enabled
      patch.status = patch.enabled ? 'waiting' : 'paused'
      patch.nextRunAt = patch.enabled
        ? Math.max(Date.now(), existing.nextRunAt || 0)
        : null
    }
    res.json(await updateCloudSyncSchedule(req.user.uid, existing.id, patch))
  } catch (err) { next(err) }
})

cloudSyncRouter.delete('/schedules/:id', async (req, res, next) => {
  try {
    await deleteCloudSyncSchedule(req.user.uid, req.params.id)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

cloudSyncRouter.post('/schedules/:id/run', async (req, res, next) => {
  let schedule = null
  try {
    schedule = await claimCloudSyncSchedule(req.user.uid, req.params.id)
    if (!schedule) return res.status(409).json({ error: '该同步计划正在执行，请稍后再试' })
    const { baiduAccount, quarkAccount } = await loadScheduleAccounts({
      userId: req.user.uid,
      baiduAccountId: schedule.baiduAccountId,
      quarkAccountId: schedule.quarkAccountId
    })
    const queued = await enqueueCloudSyncPair({
      userId: req.user.uid,
      scheduleId: schedule.id,
      baiduAccount,
      quarkAccount,
      baiduPath: schedule.baiduPath,
      quarkPath: schedule.quarkPath
    })
    await releaseCloudSyncScheduleLock(schedule.id, schedule.lockToken, {
      status: 'queued',
      lastTaskId: queued.taskId,
      lastError: '',
      nextRunAt: Date.now() + SCHEDULE_INTERVAL_MS
    })
    res.json({ ok: true, taskId: queued.taskId })
  } catch (err) {
    if (schedule?.lockToken) {
      await releaseCloudSyncScheduleLock(schedule.id, schedule.lockToken, {
        status: 'error',
        lastError: err.message || '同步任务创建失败',
        nextRunAt: Date.now() + 15 * 60 * 1000
      }).catch(() => {})
    }
    next(err)
  }
})

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
