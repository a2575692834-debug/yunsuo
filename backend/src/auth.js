import jwt from 'jsonwebtoken'
import { config } from './config.js'

export function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, config.jwtSecret, { expiresIn: '30d' })
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return res.status(401).json({ error: '请先登录' })
  try {
    req.user = jwt.verify(token, config.jwtSecret)
    next()
  } catch {
    res.status(401).json({ error: '登录已过期,请重新登录' })
  }
}
