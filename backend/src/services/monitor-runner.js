import {
  getAccountById,
  getTaskById,
  releaseMonitorLock
} from '../db.js'
import { getProvider } from '../providers/index.js'
import { parseOne } from '../utils/parse.js'
import { enqueueTransfer } from './transfer-runner.js'

function errorMessage(error) {
  return error?.message || String(error || '监控执行失败')
}

function backoffMinutes(monitor, failures) {
  return Math.min(360, Math.max(5, monitor.intervalMinutes) * 2 ** Math.min(failures, 4))
}

async function activeTask(monitor) {
  if (!monitor.lastTaskId) return null
  const task = await getTaskById(monitor.lastTaskId)
  return task && ['queued', 'running'].includes(task.status) ? task : null
}

async function inspectMonitor(monitor) {
  const account = await getAccountById(monitor.accountId)
  if (!account) {
    throw Object.assign(new Error('账号不存在或已被移除'), { status: 404 })
  }
  const link = parseOne(monitor.url)
  if (!link) throw Object.assign(new Error('分享链接无法解析'), { status: 400 })
  link.passcode = monitor.passcode
  const provider = getProvider(account.provider)
  if (typeof provider.inspectShare !== 'function') {
    throw Object.assign(new Error(`${provider.name} 暂不支持链接监控`), { status: 400 })
  }
  return {
    account,
    link,
    inspect: await provider.inspectShare(account, link, link.passcode)
  }
}

export async function runMonitorPass(monitor, { force = false } = {}) {
  const now = Date.now()
  const running = await activeTask(monitor)
  if (running) {
    const next = await releaseMonitorLock(monitor.id, monitor.lockToken, {
      status: 'syncing',
      lastError: '',
      nextCheckAt: now + Math.min(5, monitor.intervalMinutes) * 60000
    })
    return { ok: true, skipped: 'running', changed: false, monitor: next }
  }

  let inspected
  try {
    inspected = await inspectMonitor(monitor)
  } catch (error) {
    const failures = (monitor.failureCount || 0) + 1
    const next = await releaseMonitorLock(monitor.id, monitor.lockToken, {
      status: 'error',
      lastError: errorMessage(error),
      failureCount: failures,
      nextCheckAt: now + backoffMinutes(monitor, failures) * 60000
    })
    return {
      ok: false,
      changed: false,
      status: error.status || 400,
      error: errorMessage(error),
      monitor: next
    }
  }

  const { account, link, inspect } = inspected
  const changed = force || !monitor.lastSignature || inspect.signature !== monitor.lastSignature
  if (!changed) {
    const next = await releaseMonitorLock(monitor.id, monitor.lockToken, {
      status: 'idle',
      lastSignature: inspect.signature,
      lastCheckedAt: now,
      lastError: '',
      failureCount: 0,
      nextCheckAt: now + monitor.intervalMinutes * 60000
    })
    return { ok: true, changed: false, monitor: next }
  }

  try {
    const result = await enqueueTransfer({
      userId: monitor.userId,
      account,
      link,
      targetPath: monitor.targetPath,
      syncMode: true,
      autoShare: monitor.autoShare,
      unlimited: monitor.shareExpires === 0,
      expires: monitor.shareExpires,
      sharePasscode: monitor.sharePasscode,
      kind: 'monitor-sync',
      titlePrefix: '监控同步',
      detail: {
        monitorId: monitor.id,
        signature: inspect.signature,
        runMode: monitor.runMode
      }
    })
    const next = await releaseMonitorLock(monitor.id, monitor.lockToken, {
      status: 'syncing',
      lastCheckedAt: now,
      lastError: '',
      failureCount: 0,
      lastTaskId: result.task.id,
      nextCheckAt: now + monitor.intervalMinutes * 60000
    })
    return {
      ok: true,
      changed: true,
      taskId: result.task.id,
      monitor: next
    }
  } catch (error) {
    const next = await releaseMonitorLock(monitor.id, monitor.lockToken, {
      status: 'error',
      lastError: errorMessage(error),
      nextCheckAt: now + Math.min(5, monitor.intervalMinutes) * 60000
    }).catch(() => null)
    return {
      ok: false,
      changed: false,
      status: error.status || 500,
      error: errorMessage(error),
      monitor: next
    }
  }
}
