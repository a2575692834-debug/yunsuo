import {
  claimDueMonitors,
  updateMonitorById,
  findShareByTaskId,
  listMonitorsAwaitingTask,
  getTaskById
} from './db.js'
import { runMonitorPass } from './services/monitor-runner.js'

const TICK_MS = 15000
const LOCK_TTL_MS = 15 * 60 * 1000
const MAX_DUE_PER_TICK = 4

function resign(error) {
  return error?.message || String(error)
}

async function handleDue(monitor) {
  await runMonitorPass(monitor)
}

async function reconcileTasks() {
  // 转存任务结束后,把分享结果或失败原因同步回监控状态。
  const monitors = await listMonitorsAwaitingTask(50)
  for (const monitor of monitors) {
    const task = await getMonitorTask(monitor)
    if (!task || task.status === 'running' || task.status === 'queued') continue
    const share = task.status === 'done' ? await findShareByTaskId(monitor.userId, task.id) : null
    await updateMonitorById(monitor.id, {
      status: task.status === 'done' ? 'idle' : 'error',
      lastTaskId: task.id,
      lastSignature: task.status === 'done'
        ? (task.detail?.signature || monitor.lastSignature)
        : monitor.lastSignature,
      lastError: task.status === 'done' ? '' : (task.error || '监控同步失败'),
      lastShareUrl: task.status === 'done' ? (share?.url || '') : (monitor.lastShareUrl || ''),
      failureCount: task.status === 'done' ? 0 : monitor.failureCount,
      lastChangeAt: task.status === 'done' ? (task.finishedAt || Date.now()) : monitor.lastChangeAt,
      changeCount: task.status === 'done' ? (monitor.changeCount || 0) + 1 : monitor.changeCount,
      nextCheckAt: Date.now() + monitor.intervalMinutes * 60000
    })
  }
}

async function getMonitorTask(monitor) {
  if (!monitor.lastTaskId) return null
  return getTaskById(monitor.lastTaskId)
}

class MonitorScheduler {
  constructor() {
    this.timer = null
    this.running = false
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick() {
    if (this.running) return
    this.running = true
    try {
      await reconcileTasks()
      const due = await claimDueMonitors({ limit: MAX_DUE_PER_TICK, ttlMs: LOCK_TTL_MS })
      for (const monitor of due) {
        try {
          await handleDue(monitor)
        } catch (err) {
          await updateMonitorById(monitor.id, {
            status: 'error',
            lastError: resign(err),
            lockedUntil: null,
            lockToken: null,
            nextCheckAt: Date.now() + monitor.intervalMinutes * 60000
          }).catch(() => {})
        }
      }
    } finally {
      this.running = false
    }
  }
}

export const monitorScheduler = new MonitorScheduler()
