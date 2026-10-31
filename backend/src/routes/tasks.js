import { Router } from 'express'
import { authRequired } from '../auth.js'
import { listTasks, removeTask } from '../db.js'
import { queue } from '../queue.js'

export const tasksRouter = Router()
tasksRouter.use(authRequired)

tasksRouter.get('/', async (req, res, next) => {
  try {
    res.json(await listTasks(req.user.uid, {
      kind: req.query.kind ? String(req.query.kind) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      batchId: req.query.batchId ? String(req.query.batchId) : undefined
    }))
  } catch (err) { next(err) }
})

tasksRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    res.json({ ok: await queue.cancel(req.user.uid, req.params.id) })
  } catch (err) { next(err) }
})

tasksRouter.delete('/:id', async (req, res, next) => {
  try {
    await removeTask(req.user.uid, req.params.id)
    res.json({ ok: true })
  } catch (err) { next(err) }
})
