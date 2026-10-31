import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { createUser, findUserByName, findUserById, setPublicTransfers } from '../db.js'
import { signToken, authRequired } from '../auth.js'

export const authRouter = Router()

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  isAdmin: !!u.is_admin,
  publicTransfers: !!u.public_transfers
})

authRouter.post('/register', async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    if (username.length < 3 || username.length > 32) return res.status(400).json({ error: '用户名需为 3-32 个字符' })
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' })
    if (await findUserByName(username)) return res.status(400).json({ error: '用户名已存在' })
    const user = await createUser(username, await bcrypt.hash(password, 10))
    res.json({ token: signToken(user), user: publicUser(user) })
  } catch (err) { next(err) }
})

authRouter.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    const user = await findUserByName(username)
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(400).json({ error: '用户名或密码不正确' })
    }
    res.json({ token: signToken(user), user: publicUser(user) })
  } catch (err) { next(err) }
})

authRouter.get('/me', authRequired, async (req, res, next) => {
  try {
    const user = await findUserById(req.user.uid)
    if (!user) return res.status(404).json({ error: '用户不存在' })
    res.json({ user: publicUser(user) })
  } catch (err) { next(err) }
})

authRouter.patch('/privacy', authRequired, async (req, res, next) => {
  try {
    if (typeof req.body?.publicTransfers !== 'boolean') {
      return res.status(400).json({ error: '公开设置格式不正确' })
    }
    const user = await setPublicTransfers(req.user.uid, req.body.publicTransfers)
    if (!user) return res.status(404).json({ error: '用户不存在' })
    res.json({ user: publicUser(user) })
  } catch (err) { next(err) }
})

