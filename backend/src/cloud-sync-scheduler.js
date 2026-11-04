import {
  claimDueCloudSyncSchedules,
  getAccount,
  getTaskById,
  listCloudSyncSchedulesAwaitingTask,
  releaseCloudSyncScheduleLock,
  updateCloudSyncScheduleById
} from './db.js'
import { enqueueCloudSyncPair, validateCloudSyncPair } from './services/cloud-sync.js'

const TICK_MS = 20000
const LOCK_TTL_MS = 2 * 60 * 60 * 1000
const MAX_DUE_PER_TICK = 2

function errorMessage(error) {
  return error?.message || String(error)
}

function intervalMs(schedule) {
  return Math.max(1, Number(schedule.intervalHours || 24)) * 60 * 60 * 1000
}

async function reconcileTasks() {
  const schedules = await listCloudSyncSchedulesAwaitingTask(50)
  for (const schedule of schedules) {
    const task = schedule.lastTaskId ? await getTaskById(schedule.lastTaskId) : null
    if (task && ['queued', 'running'].includes(task.status)) continue

    const done = task?.status === 'done'
    const canceled = task?.status === 'canceled'
    const lastError = done
      ? ''
      : canceled
        ? '同步任务已取消'
        : (task?.error || '同步任务未正常完成')

    await updateCloudSyncScheduleById(schedule.id, {
      status: schedule.enabled ? (done || canceled ? 'waiting' : 'error') : 'paused',
      lastRunAt: done ? (task.finishedAt || Date.now()) : schedule.lastRunAt,
      lastError,
      runCount: done ? (schedule.runCount || 0) + 1 : schedule.runCount,
      lastTaskId: task ? task.id : null,
      nextRunAt: schedule.enabled
        ? (schedule.nextRunAt || Date.now() + intervalMs(schedule))
        : null
    })
  }
}

async function handleDue(schedule) {
  try {
    const [baiduAccount, quarkAccount] = await Promise.all([
      getAccount(schedule.userId, schedule.baiduAccountId),
      getAccount(schedule.userId, schedule.quarkAccountId)
    ])
    validateCloudSyncPair(baiduAccount, quarkAccount)

    const queued = await enqueueCloudSyncPair({
      userId: schedule.userId,
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
      nextRunAt: Date.now() + intervalMs(schedule)
    })
  } catch (err) {
    await releaseCloudSyncScheduleLock(schedule.id, schedule.lockToken, {
      status: 'error',
      lastError: errorMessage(err),
      nextRunAt: Date.now() + intervalMs(schedule)
    })
  }
}

class CloudSyncScheduler {
  constructor() {
    this.timer = null
    this.running = false
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS)
    this.timer.unref?.()
    this.tick().catch(() => {})
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
      const due = await claimDueCloudSyncSchedules({
        limit: MAX_DUE_PER_TICK,
        ttlMs: LOCK_TTL_MS
      })
      for (const schedule of due) {
        await handleDue(schedule)
      }
    } finally {
      this.running = false
    }
  }
}

export const cloudSyncScheduler = new CloudSyncScheduler()
