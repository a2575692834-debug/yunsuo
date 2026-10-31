import { Router } from 'express'
import { authRequired } from '../auth.js'
import { q, listAccounts, listTasks, listShares, listResources } from '../db.js'

export const overviewRouter = Router()
overviewRouter.use(authRequired)

async function count(sql, params) {
  const [rows] = await q(sql, params)
  return Number(rows[0]?.n || 0)
}

overviewRouter.get('/', async (req, res, next) => {
  try {
    const uid = req.user.uid
    const [accountCount, doneCount, runningCount, shareCount, resourceCount, accounts, tasks, shares, resources] = await Promise.all([
      count('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?', [uid]),
      count("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'done'", [uid]),
      count("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status IN ('running','queued')", [uid]),
      count('SELECT COUNT(*) AS n FROM shares WHERE user_id = ?', [uid]),
      count('SELECT COUNT(*) AS n FROM resources WHERE user_id = ?', [uid]),
      listAccounts(uid),
      listTasks(uid, { limit: 6 }),
      listShares(uid),
      listResources(uid)
    ])
    res.json({
      stats: { accounts: accountCount, done: doneCount, running: runningCount, shares: shareCount, resources: resourceCount },
      accounts,
      recentTasks: tasks,
      recentShares: shares.slice(0, 4),
      recentResources: resources.slice(0, 4)
    })
  } catch (err) { next(err) }
})
