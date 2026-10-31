import { newId, insertTask, patchTask, getTask, markTasksInterrupted } from './db.js'

const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

class TaskQueue {
  constructor() {
    this.pending = []
    this.active = new Map()
    this.running = 0
    this.max = 2
  }

  async add(userId, kind, title, detail, runner) {
    const task = {
      id: newId('task'),
      userId,
      kind,
      title,
      detail,
      status: 'queued',
      progress: 0,
      logs: [`[${stamp()}] 已加入队列`],
      error: null,
      createdAt: Date.now(),
      finishedAt: null
    }
    await insertTask(task)
    this.pending.push({ task, runner })
    this.pump()
    return task
  }

  pump() {
    while (this.running < this.max && this.pending.length) {
      const item = this.pending.shift()
      this.run(item)
    }
  }

  async run({ task, runner }) {
    task.status = 'running'
    this.active.set(task.id, task)
    this.running++
    await patchTask(task.id, { status: 'running' })

    const api = {
      taskId: task.id,
      progress: async (value) => {
        task.progress = Math.max(0, Math.min(100, Math.round(value)))
        await patchTask(task.id, { progress: task.progress })
      },
      log: async (message) => {
        task.logs.push(`[${stamp()}] ${message}`)
        if (task.logs.length > 80) task.logs.shift()
        await patchTask(task.id, { logs: task.logs })
      },
      rename: async (title) => {
        task.title = String(title).slice(0, 200)
        await patchTask(task.id, { title: task.title })
      },
      canceled: () => task.status === 'canceled'
    }

    try {
      await runner(api)
      if (task.status !== 'canceled') {
        task.status = 'done'
        task.progress = 100
      }
    } catch (err) {
      if (task.status !== 'canceled') {
        task.status = 'error'
        task.error = err.message
        task.logs.push(`[${stamp()}] 失败: ${err.message}`)
      }
    }

    task.finishedAt = Date.now()
    await patchTask(task.id, {
      status: task.status,
      progress: task.progress,
      logs: task.logs,
      error: task.error,
      finishedAt: task.finishedAt
    })
    this.active.delete(task.id)
    this.running--
    this.pump()
  }

  async cancel(userId, id) {
    const task = await getTask(userId, id)
    if (!task) return false
    const queued = this.pending.find((x) => x.task.id === id)
    if (queued) {
      this.pending = this.pending.filter((x) => x.task.id !== id)
      queued.task.status = 'canceled'
      await patchTask(id, { status: 'canceled', finishedAt: Date.now() })
      return true
    }
    const running = this.active.get(id)
    if (running) {
      running.status = 'canceled'
      await patchTask(id, { status: 'canceled' })
      return true
    }
    return false
  }

  async restore() {
    await markTasksInterrupted()
  }
}

export const queue = new TaskQueue()

export async function animatedProgress(api, work) {
  for (const p of [12, 28, 44, 60, 72]) {
    if (api.canceled()) return
    await api.progress(p)
    await new Promise((r) => setTimeout(r, 140))
  }
  await work()
  for (const p of [84, 93, 100]) {
    if (api.canceled()) return
    await api.progress(p)
    await new Promise((r) => setTimeout(r, 100))
  }
}
