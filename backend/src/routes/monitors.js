import { Router } from 'express'
import { authRequired } from '../auth.js'
import { parseOne } from '../utils/parse.js'
import {
  getAccount,
  getMonitor,
  listMonitors,
  insertMonitor,
  updateMonitor,
  deleteMonitor,
  claimMonitor,
  releaseMonitorLock,
  newId
} from '../db.js'
import { resolveShareExpiry } from '../utils/share.js'
import { normalizeTargetPath, defaultTargetPath } from '../utils/path.js'
import { runMonitorPass } from '../services/monitor-runner.js'

export const monitorsRouter = Router()
monitorsRouter.use(authRequired)

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status })
}

const INTERVALS = [5, 15, 30, 60, 360, 720, 1440]

function normalizeInterval(value) {
  const minutes = Math.trunc(Number(value || 0))
  if (!Number.isFinite(minutes) || minutes <= 0) fail('检查间隔不合法')
  return Math.min(1440, Math.max(5, minutes))
}

function providerPasscode(provider, requested) {
  if (provider === 'quark') return ''
  return String(requested || '').trim().toUpperCase()
}

function normalizeRunMode(value, fallback = 'cloud') {
  const mode = String(value || '').trim().toLowerCase()
  if (!mode) return fallback
  if (!['cloud', 'local'].includes(mode)) fail('监控运行方式只支持云端或本地')
  return mode
}

monitorsRouter.get('/', async (req, res, next) => {
  try {
    res.json(await listMonitors(req.user.uid))
  } catch (err) { next(err) }
})

monitorsRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body || {}
    const text = String(body.text || body.url || '')
    const link = body.link ? parseOne(String(body.link.url || '')) : parseOne(text)
    if (!link) return res.status(400).json({ error: '没有识别到百度 / 夸克 / 迅雷分享链接' })
    if (body.text && !body.link && !String(body.text).includes(link.url)) {
      // 整段文案里识别到首个有效链接即可,不强校验整段。
    }

    const accountId = String(body.accountId || '')
    if (!accountId) return res.status(400).json({ error: '请选择用于转存的网盘账号' })
    const account = await getAccount(req.user.uid, accountId)
    if (!account) return res.status(404).json({ error: '账号不存在' })
    if (account.provider !== link.provider) {
      return res.status(400).json({ error: `账号类型与链接不符,需要 ${link.providerName} 账号` })
    }

    const targetPath = normalizeTargetPath(body.targetPath, defaultTargetPath())
    if (!targetPath) return res.status(400).json({ error: '转存目录包含不支持的字符' })

    const autoShare = body.autoShare === true
    const share = resolveShareExpiry(body)
    const sharePasscode = providerPasscode(account.provider, body.sharePasscode)

    const monitor = {
      id: newId('mon'),
      userId: req.user.uid,
      accountId: account.id,
      provider: account.provider,
      url: link.url,
      passcode: String(link.passcode || '').trim(),
      title: String(body.title || link.key).slice(0, 200),
      targetPath,
      intervalMinutes: normalizeInterval(body.intervalMinutes),
      runMode: normalizeRunMode(body.runMode),
      autoShare,
      shareExpires: share.expires,
      sharePasscode: autoShare ? sharePasscode : '',
      enabled: true,
      status: 'waiting',
      nextCheckAt: Date.now()
    }
    await insertMonitor(monitor)
    res.json(await getMonitor(req.user.uid, monitor.id))
  } catch (err) { next(err) }
})

monitorsRouter.patch('/:id', async (req, res, next) => {
  try {
    const existing = await getMonitor(req.user.uid, req.params.id)
    if (!existing) return res.status(404).json({ error: '监控不存在' })
    const body = req.body || {}
    const patch = {}

    if (body.accountId !== undefined) {
      const account = await getAccount(req.user.uid, String(body.accountId))
      if (!account) return res.status(404).json({ error: '账号不存在' })
      patch.accountId = account.id
      patch.provider = account.provider
    }
    if (body.targetPath !== undefined) {
      const targetPath = normalizeTargetPath(body.targetPath, existing.targetPath)
      if (!targetPath) return res.status(400).json({ error: '转存目录包含不支持的字符' })
      patch.targetPath = targetPath
    }
    if (body.intervalMinutes !== undefined) patch.intervalMinutes = normalizeInterval(body.intervalMinutes)
    if (body.runMode !== undefined) {
      patch.runMode = normalizeRunMode(body.runMode, existing.runMode)
      patch.nextCheckAt = Date.now()
      patch.status = existing.enabled ? 'waiting' : 'paused'
    }
    if (body.autoShare !== undefined) patch.autoShare = !!body.autoShare
    if (body.shareExpires !== undefined || body.unlimited !== undefined) {
      const share = resolveShareExpiry(body)
      patch.shareExpires = share.expires
    }
    if (body.sharePasscode !== undefined) {
      const account = await getAccount(req.user.uid, patch.accountId || existing.accountId)
      patch.sharePasscode = providerPasscode(account.provider, body.sharePasscode)
    }
    if (body.passcode !== undefined) patch.passcode = String(body.passcode || '').trim()
    if (body.title !== undefined) patch.title = String(body.title || '').slice(0, 200)
    if (body.enabled !== undefined) {
      patch.enabled = !!body.enabled
      patch.nextCheckAt = patch.enabled ? Date.now() : null
      patch.status = patch.enabled ? 'waiting' : 'paused'
    }

    res.json(await updateMonitor(req.user.uid, req.params.id, patch))
  } catch (err) { next(err) }
})

monitorsRouter.delete('/:id', async (req, res, next) => {
  try {
    await deleteMonitor(req.user.uid, req.params.id)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

monitorsRouter.post('/:id/check', async (req, res, next) => {
  try {
    const monitor = await claimMonitor(req.user.uid, req.params.id)
    if (!monitor) return res.status(409).json({ error: '监控正在检查,请稍后重试' })
    if (monitor.runMode === 'local') {
      const result = await runMonitorPass(monitor)
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error })
      return res.json({
        ok: true,
        monitorId: monitor.id,
        taskId: result.taskId || '',
        changed: result.changed,
        message: result.changed ? '内容有更新，已创建同步任务' : '检查完成，内容没有变化'
      })
    }
    await releaseMonitorLock(monitor.id, monitor.lockToken, {
      status: 'waiting',
      nextCheckAt: Date.now()
    })
    res.json({ ok: true, monitorId: monitor.id, message: '已开始检查' })
  } catch (err) { next(err) }
})

monitorsRouter.post('/:id/local-run', async (req, res, next) => {
  let monitor = null
  try {
    monitor = await claimMonitor(req.user.uid, req.params.id)
    if (!monitor) return res.status(409).json({ error: '监控正在执行,请稍后重试' })
    if (monitor.runMode !== 'local') {
      await releaseMonitorLock(monitor.id, monitor.lockToken, {
        status: monitor.enabled ? 'waiting' : 'paused',
        nextCheckAt: monitor.nextCheckAt || Date.now()
      })
      return res.status(400).json({ error: '该监控不是本地运行模式' })
    }
    const result = await runMonitorPass(monitor)
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error })
    res.json({
      ok: true,
      monitorId: monitor.id,
      taskId: result.taskId || '',
      changed: result.changed
    })
  } catch (err) { next(err) }
})

monitorsRouter.post('/:id/sync', async (req, res, next) => {
  let monitor = null
  try {
    monitor = await claimMonitor(req.user.uid, req.params.id)
    if (!monitor) return res.status(409).json({ error: '监控正在同步,请稍后重试' })
    const result = await runMonitorPass(monitor, { force: true })
    if (result.skipped === 'running') {
      return res.status(409).json({ error: '该监控已有同步任务正在执行' })
    }
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error })
    res.json({ ok: true, taskId: result.taskId })
  } catch (err) {
    if (monitor) {
      await releaseMonitorLock(monitor.id, monitor.lockToken, {
        status: 'error',
        lastError: err.message || '同步任务创建失败',
        nextCheckAt: Date.now() + Math.min(5, monitor.intervalMinutes || 5) * 60000
      }).catch(() => {})
    }
    next(err)
  }
})
