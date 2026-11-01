import mysql from 'mysql2/promise'
import crypto from 'node:crypto'
import { config } from './config.js'

let pool = null
const COOKIE_PREFIX = 'enc:v1:'

function cookieKey() {
  return crypto.createHash('sha256').update(config.cookieSecret).digest()
}

export function encryptCookie(value) {
  if (!value) return null
  if (String(value).startsWith(COOKIE_PREFIX)) return value
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cookieKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${COOKIE_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

export function decryptCookie(value) {
  if (!value) return value
  const text = String(value)
  if (!text.startsWith(COOKIE_PREFIX)) return text
  try {
    const [ivRaw, tagRaw, dataRaw] = text.slice(COOKIE_PREFIX.length).split(':')
    const decipher = crypto.createDecipheriv('aes-256-gcm', cookieKey(), Buffer.from(ivRaw, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataRaw, 'base64url')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw Object.assign(new Error('网盘登录凭据无法解密，请重新连接账号'), { status: 500 })
  }
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
}

export async function q(sql, params = []) {
  if (!pool) throw new Error('database not ready')
  return pool.query(sql, params)
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(40) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  is_admin TINYINT NOT NULL DEFAULT 0,
  public_transfers TINYINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(40) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(20) NOT NULL,
  label VARCHAR(80) NOT NULL,
  cookie MEDIUMTEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  KEY idx_accounts_user (user_id),
  CONSTRAINT fk_accounts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS monitors (
  id VARCHAR(40) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  account_id VARCHAR(40) NOT NULL,
  provider VARCHAR(20) NOT NULL,
  url TEXT NOT NULL,
  passcode VARCHAR(20),
  title VARCHAR(200),
  target_path TEXT NOT NULL,
  interval_minutes INT NOT NULL,
  run_mode VARCHAR(12) NOT NULL DEFAULT 'cloud',
  auto_share TINYINT NOT NULL DEFAULT 1,
  share_expires INT NOT NULL DEFAULT 0,
  share_passcode VARCHAR(20),
  enabled TINYINT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  last_signature VARCHAR(64),
  last_checked_at BIGINT,
  next_check_at BIGINT,
  last_change_at BIGINT,
  last_error TEXT,
  last_task_id VARCHAR(40),
  last_share_url TEXT,
  change_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,
  lock_token VARCHAR(40),
  locked_until BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  KEY idx_monitors_user (user_id, created_at),
  KEY idx_monitors_due (enabled, next_check_at),
  KEY idx_monitors_account (account_id),
  CONSTRAINT fk_monitors_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_monitors_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(40) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL,
  detail JSON,
  status VARCHAR(16) NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  logs JSON,
  error TEXT,
  created_at BIGINT NOT NULL,
  finished_at BIGINT,
  KEY idx_tasks_user (user_id, created_at),
  CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shares (
  id VARCHAR(40) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  account_id VARCHAR(40),
  provider VARCHAR(20),
  batch_id VARCHAR(40),
  task_id VARCHAR(40),
  title VARCHAR(200),
  url TEXT,
  passcode VARCHAR(20),
  expires INT,
  created_at BIGINT,
  KEY idx_shares_user (user_id, created_at),
  KEY idx_shares_batch (batch_id, created_at),
  CONSTRAINT fk_shares_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS resources (
  id VARCHAR(40) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  account_id VARCHAR(40),
  provider VARCHAR(20),
  title VARCHAR(200),
  source_url TEXT,
  source_code VARCHAR(20),
  saved_path TEXT,
  task_id VARCHAR(40),
  batch_id VARCHAR(40),
  created_at BIGINT,
  KEY idx_resources_user (user_id, created_at),
  KEY idx_resources_task (task_id),
  KEY idx_resources_batch (batch_id),
  CONSTRAINT fk_resources_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS demo_tree (
  account_id VARCHAR(40) PRIMARY KEY,
  tree JSON NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

export async function initDb() {
  let tries = 0
  for (;;) {
    try {
      pool = mysql.createPool({
        ...config.mysql,
        waitForConnections: true,
        connectionLimit: 8,
        charset: 'utf8mb4'
      })
      const statements = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)
      for (const sql of statements) await pool.query(sql)
      const [columns] = await pool.query(
        `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_admin'`,
        [config.mysql.database]
      )
      if (!Number(columns[0]?.n)) {
        await pool.query('ALTER TABLE users ADD COLUMN is_admin TINYINT NOT NULL DEFAULT 0 AFTER password_hash')
      }
      const migrations = [
        ['users', 'public_transfers', 'ALTER TABLE users ADD COLUMN public_transfers TINYINT NOT NULL DEFAULT 0 AFTER is_admin'],
        ['users', 'updated_at', 'ALTER TABLE users ADD COLUMN updated_at BIGINT NULL AFTER created_at'],
        ['accounts', 'updated_at', 'ALTER TABLE accounts ADD COLUMN updated_at BIGINT NULL AFTER created_at'],
        ['resources', 'task_id', 'ALTER TABLE resources ADD COLUMN task_id VARCHAR(40) NULL AFTER saved_path'],
        ['resources', 'batch_id', 'ALTER TABLE resources ADD COLUMN batch_id VARCHAR(40) NULL AFTER task_id'],
        ['monitors', 'run_mode', "ALTER TABLE monitors ADD COLUMN run_mode VARCHAR(12) NOT NULL DEFAULT 'cloud' AFTER interval_minutes"]
      ]
      for (const [table, column, statement] of migrations) {
        const [found] = await pool.query(
          `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [config.mysql.database, table, column]
        )
        if (!Number(found[0]?.n)) await pool.query(statement)
      }
      await pool.query('UPDATE users SET updated_at = created_at WHERE updated_at IS NULL')
      await pool.query('UPDATE accounts SET updated_at = created_at WHERE updated_at IS NULL')
      const shareMigrations = [
        ['batch_id', 'ALTER TABLE shares ADD COLUMN batch_id VARCHAR(40) NULL AFTER provider'],
        ['task_id', 'ALTER TABLE shares ADD COLUMN task_id VARCHAR(40) NULL AFTER batch_id']
      ]
      for (const [column, statement] of shareMigrations) {
        const [found] = await pool.query(
          `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'shares' AND COLUMN_NAME = ?`,
          [config.mysql.database, column]
        )
        if (!Number(found[0]?.n)) await pool.query(statement)
      }
      const [batchIndex] = await pool.query(
        `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'shares' AND INDEX_NAME = 'idx_shares_batch'`,
        [config.mysql.database]
      )
      if (!Number(batchIndex[0]?.n)) {
        await pool.query('ALTER TABLE shares ADD INDEX idx_shares_batch (batch_id, created_at)')
      }
      const resourceIndexes = [
        ['idx_resources_task', 'ALTER TABLE resources ADD INDEX idx_resources_task (task_id)'],
        ['idx_resources_batch', 'ALTER TABLE resources ADD INDEX idx_resources_batch (batch_id)']
      ]
      for (const [indexName, statement] of resourceIndexes) {
        const [found] = await pool.query(
          `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'resources' AND INDEX_NAME = ?`,
          [config.mysql.database, indexName]
        )
        if (!Number(found[0]?.n)) await pool.query(statement)
      }
      return
    } catch (err) {
      tries++
      if (tries > 40) throw err
      console.log(`[db] waiting for mysql ${tries}/40 (${err.code || err.message})`)
      await new Promise((r) => setTimeout(r, 1200))
    }
  }
}

export async function closeDb() {
  if (pool) await pool.end()
  pool = null
}

const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v))
const parse = (v, fallback) => {
  if (v === null || v === undefined) return fallback
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return fallback }
}

// users
export async function createUser(username, passwordHash, isAdmin = false) {
  const now = Date.now()
  const [r] = await q(
    'INSERT INTO users (username, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [username, passwordHash, isAdmin ? 1 : 0, now, now]
  )
  return findUserById(r.insertId)
}

export async function setAdmin(userId, isAdmin = true) {
  await q('UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?', [isAdmin ? 1 : 0, Date.now(), userId])
}

export async function setPublicTransfers(userId, enabled = false) {
  await q('UPDATE users SET public_transfers = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, Date.now(), userId])
  return findUserById(userId)
}

export async function findUserByName(username) {
  const [rows] = await q('SELECT * FROM users WHERE username = ? LIMIT 1', [username])
  return rows[0] || null
}

export async function findUserById(id) {
  const [rows] = await q('SELECT * FROM users WHERE id = ? LIMIT 1', [id])
  return rows[0] || null
}

export async function countAdmins() {
  const [rows] = await q('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1')
  return Number(rows[0]?.n || 0)
}

export async function listUsersForAdmin({ keyword = '', page = 1, pageSize = 20 } = {}) {
  const where = []
  const params = []
  if (keyword) {
    where.push('u.username LIKE ?')
    params.push(`%${keyword}%`)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [countRows] = await q(
    `SELECT COUNT(*) AS n FROM users u ${clause}`,
    params
  )
  const offset = (page - 1) * pageSize
  const [rows] = await q(
    `SELECT
       u.id, u.username, u.is_admin, u.created_at, u.updated_at,
       COUNT(DISTINCT a.id) AS account_count,
       COUNT(DISTINCT r.id) AS transfer_count,
       COUNT(DISTINCT s.id) AS share_count,
       COUNT(DISTINCT t.id) AS task_count
     FROM users u
     LEFT JOIN accounts a ON a.user_id = u.id
     LEFT JOIN resources r ON r.user_id = u.id
     LEFT JOIN shares s ON s.user_id = u.id
     LEFT JOIN tasks t ON t.user_id = u.id
     ${clause}
     GROUP BY u.id
     ORDER BY u.is_admin DESC, u.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  return {
    total: Number(countRows[0]?.n || 0),
    items: rows.map((row) => ({
      id: row.id,
      username: row.username,
      isAdmin: !!row.is_admin,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
      accountCount: Number(row.account_count || 0),
      transferCount: Number(row.transfer_count || 0),
      shareCount: Number(row.share_count || 0),
      taskCount: Number(row.task_count || 0)
    }))
  }
}

export async function updateUserForAdmin(id, patch = {}) {
  const sets = []
  const params = []
  if (patch.passwordHash !== undefined) {
    sets.push('password_hash = ?')
    params.push(patch.passwordHash)
  }
  if (patch.isAdmin !== undefined) {
    sets.push('is_admin = ?')
    params.push(patch.isAdmin ? 1 : 0)
  }
  if (!sets.length) return findUserById(id)
  sets.push('updated_at = ?')
  params.push(Date.now(), id)
  await q(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params)
  return findUserById(id)
}

export async function deleteUserForAdmin(id) {
  await q(
    'DELETE dt FROM demo_tree dt JOIN accounts a ON a.id = dt.account_id WHERE a.user_id = ?',
    [id]
  )
  await q('DELETE FROM users WHERE id = ?', [id])
}

// accounts
const mapAccount = (r) => r && ({
  id: r.id,
  userId: r.user_id,
  provider: r.provider,
  label: r.label,
  cookie: decryptCookie(r.cookie),
  createdAt: r.created_at,
  updatedAt: r.updated_at || r.created_at
})

export async function insertAccount(a) {
  const now = a.createdAt || Date.now()
  await q(
    'INSERT INTO accounts (id, user_id, provider, label, cookie, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [a.id, a.userId, a.provider, a.label, encryptCookie(a.cookie), now, now]
  )
  return a
}

export async function listAccounts(userId) {
  const [rows] = await q('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC', [userId])
  return rows.map(mapAccount)
}

export async function getAccount(userId, id) {
  const [rows] = await q('SELECT * FROM accounts WHERE id = ? AND user_id = ? LIMIT 1', [id, userId])
  return mapAccount(rows[0])
}

export async function getAccountById(id) {
  const [rows] = await q('SELECT * FROM accounts WHERE id = ? LIMIT 1', [id])
  return mapAccount(rows[0])
}

export async function updateAccount(userId, id, patch) {
  const sets = []
  const params = []
  if (patch.label !== undefined) { sets.push('label = ?'); params.push(patch.label) }
  if (patch.cookie !== undefined) { sets.push('cookie = ?'); params.push(encryptCookie(patch.cookie)) }
  if (!sets.length) return getAccount(userId, id)
  sets.push('updated_at = ?')
  params.push(Date.now())
  params.push(id, userId)
  await q(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params)
  return getAccount(userId, id)
}

export async function deleteAccount(userId, id) {
  await q('DELETE FROM demo_tree WHERE account_id = ?', [id])
  await q('DELETE FROM accounts WHERE id = ? AND user_id = ?', [id, userId])
}

export async function listAccountsForAdmin({ keyword = '', provider = '', page = 1, pageSize = 20 } = {}) {
  const where = []
  const params = []
  if (keyword) {
    const like = `%${keyword}%`
    where.push('(u.username LIKE ? OR a.label LIKE ?)')
    params.push(like, like)
  }
  if (provider) {
    where.push('a.provider = ?')
    params.push(provider)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [countRows] = await q(
    `SELECT COUNT(*) AS n
     FROM accounts a
     JOIN users u ON u.id = a.user_id
     ${clause}`,
    params
  )
  const offset = (page - 1) * pageSize
  const [rows] = await q(
    `SELECT
       a.id, a.user_id, a.provider, a.label, a.created_at, a.updated_at,
       (a.cookie IS NOT NULL AND a.cookie <> '') AS has_cookie,
       u.username
     FROM accounts a
     JOIN users u ON u.id = a.user_id
     ${clause}
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  return {
    total: Number(countRows[0]?.n || 0),
    items: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      provider: row.provider,
      label: row.label,
      hasCookie: !!Number(row.has_cookie),
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at
    }))
  }
}

export async function updateAccountForAdmin(id, patch = {}) {
  const sets = []
  const params = []
  if (patch.label !== undefined) {
    sets.push('label = ?')
    params.push(patch.label)
  }
  if (patch.cookie !== undefined) {
    sets.push('cookie = ?')
    params.push(encryptCookie(patch.cookie))
  }
  if (!sets.length) return getAccountById(id)
  sets.push('updated_at = ?')
  params.push(Date.now(), id)
  await q(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, params)
  return getAccountById(id)
}

export async function deleteAccountForAdmin(id) {
  await q('DELETE FROM demo_tree WHERE account_id = ?', [id])
  await q('DELETE FROM accounts WHERE id = ?', [id])
}

// monitors
const mapMonitor = (r) => r && ({
  id: r.id,
  userId: r.user_id,
  accountId: r.account_id,
  accountLabel: r.account_label || null,
  provider: r.provider,
  url: r.url,
  passcode: r.passcode || '',
  title: r.title || '',
  targetPath: r.target_path,
  intervalMinutes: Number(r.interval_minutes),
  runMode: r.run_mode === 'local' ? 'local' : 'cloud',
  autoShare: !!Number(r.auto_share),
  shareExpires: Number(r.share_expires || 0),
  sharePasscode: r.share_passcode || '',
  enabled: !!Number(r.enabled),
  status: r.status,
  lastSignature: r.last_signature || '',
  lastCheckedAt: r.last_checked_at || null,
  nextCheckAt: r.next_check_at || null,
  lastChangeAt: r.last_change_at || null,
  lastError: r.last_error || '',
  lastTaskId: r.last_task_id || '',
  lastTaskStatus: r.last_task_status || '',
  lastTaskProgress: Number(r.last_task_progress || 0),
  lastTaskError: r.last_task_error || '',
  lastShareUrl: r.last_share_url || '',
  changeCount: Number(r.change_count || 0),
  failureCount: Number(r.failure_count || 0),
  lockToken: r.lock_token || '',
  lockedUntil: r.locked_until || null,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const MONITOR_SELECT = `
  SELECT m.*, a.label AS account_label,
         lt.status AS last_task_status,
         lt.progress AS last_task_progress,
         lt.error AS last_task_error
  FROM monitors m
  LEFT JOIN accounts a ON a.id = m.account_id
  LEFT JOIN tasks lt ON lt.id = m.last_task_id
`

export async function insertMonitor(monitor) {
  const now = monitor.createdAt || Date.now()
  await q(
    `INSERT INTO monitors
      (id, user_id, account_id, provider, url, passcode, title, target_path,
       interval_minutes, run_mode, auto_share, share_expires, share_passcode, enabled, status,
       last_signature, last_checked_at, next_check_at, last_change_at, last_error,
       last_task_id, last_share_url, change_count, failure_count, lock_token,
       locked_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      monitor.id,
      monitor.userId,
      monitor.accountId,
      monitor.provider,
      monitor.url,
      monitor.passcode || null,
      monitor.title || null,
      monitor.targetPath,
      monitor.intervalMinutes,
      monitor.runMode === 'local' ? 'local' : 'cloud',
      monitor.autoShare === false ? 0 : 1,
      monitor.shareExpires || 0,
      monitor.sharePasscode || null,
      monitor.enabled === false ? 0 : 1,
      monitor.status || 'waiting',
      monitor.lastSignature || null,
      monitor.lastCheckedAt || null,
      monitor.nextCheckAt || null,
      monitor.lastChangeAt || null,
      monitor.lastError || null,
      monitor.lastTaskId || null,
      monitor.lastShareUrl || null,
      monitor.changeCount || 0,
      monitor.failureCount || 0,
      monitor.lockToken || null,
      monitor.lockedUntil || null,
      now,
      now
    ]
  )
  return getMonitorById(monitor.id)
}

export async function listMonitors(userId) {
  const [rows] = await q(
    `${MONITOR_SELECT} WHERE m.user_id = ? ORDER BY m.created_at DESC`,
    [userId]
  )
  return rows.map(mapMonitor)
}

export async function getMonitor(userId, id) {
  const [rows] = await q(
    `${MONITOR_SELECT} WHERE m.id = ? AND m.user_id = ? LIMIT 1`,
    [id, userId]
  )
  return mapMonitor(rows[0])
}

export async function getMonitorById(id) {
  const [rows] = await q(`${MONITOR_SELECT} WHERE m.id = ? LIMIT 1`, [id])
  return mapMonitor(rows[0])
}

const MONITOR_PATCH_COLUMNS = {
  accountId: 'account_id',
  provider: 'provider',
  url: 'url',
  passcode: 'passcode',
  title: 'title',
  targetPath: 'target_path',
  intervalMinutes: 'interval_minutes',
  runMode: 'run_mode',
  autoShare: 'auto_share',
  shareExpires: 'share_expires',
  sharePasscode: 'share_passcode',
  enabled: 'enabled',
  status: 'status',
  lastSignature: 'last_signature',
  lastCheckedAt: 'last_checked_at',
  nextCheckAt: 'next_check_at',
  lastChangeAt: 'last_change_at',
  lastError: 'last_error',
  lastTaskId: 'last_task_id',
  lastShareUrl: 'last_share_url',
  changeCount: 'change_count',
  failureCount: 'failure_count',
  lockToken: 'lock_token',
  lockedUntil: 'locked_until'
}

function monitorPatchParts(patch = {}) {
  const sets = []
  const params = []
  for (const [key, column] of Object.entries(MONITOR_PATCH_COLUMNS)) {
    if (patch[key] === undefined) continue
    let value = patch[key]
    if (['autoShare', 'enabled'].includes(key)) value = value ? 1 : 0
    sets.push(`${column} = ?`)
    params.push(value)
  }
  return { sets, params }
}

export async function updateMonitor(userId, id, patch = {}) {
  const { sets, params } = monitorPatchParts(patch)
  if (!sets.length) return getMonitor(userId, id)
  sets.push('updated_at = ?')
  params.push(Date.now(), id, userId)
  await q(`UPDATE monitors SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params)
  return getMonitor(userId, id)
}

export async function updateMonitorById(id, patch = {}) {
  const { sets, params } = monitorPatchParts(patch)
  if (!sets.length) return getMonitorById(id)
  sets.push('updated_at = ?')
  params.push(Date.now(), id)
  await q(`UPDATE monitors SET ${sets.join(', ')} WHERE id = ?`, params)
  return getMonitorById(id)
}

export async function deleteMonitor(userId, id) {
  await q('DELETE FROM monitors WHERE id = ? AND user_id = ?', [id, userId])
}

export async function claimDueMonitors({ limit = 4, ttlMs = 5 * 60 * 1000 } = {}) {
  const now = Date.now()
  const [rows] = await q(
    `SELECT * FROM monitors
     WHERE enabled = 1
       AND run_mode = 'cloud'
       AND next_check_at IS NOT NULL
       AND next_check_at <= ?
       AND (locked_until IS NULL OR locked_until < ?)
     ORDER BY next_check_at ASC
     LIMIT ?`,
    [now, now, limit]
  )
  const claimed = []
  for (const row of rows) {
    const lockToken = newId('mlock')
    const [result] = await q(
      `UPDATE monitors
       SET lock_token = ?, locked_until = ?, status = IF(status = 'syncing', status, 'checking'), updated_at = ?
       WHERE id = ? AND enabled = 1 AND run_mode = 'cloud' AND next_check_at <= ?
         AND (locked_until IS NULL OR locked_until < ?)`,
      [lockToken, now + ttlMs, now, row.id, now, now]
    )
    if (result.affectedRows) {
      claimed.push(mapMonitor({
        ...row,
        status: row.status === 'syncing' ? row.status : 'checking',
        lock_token: lockToken,
        locked_until: now + ttlMs
      }))
    }
  }
  return claimed
}

export async function claimMonitor(userId, id, ttlMs = 5 * 60 * 1000) {
  const now = Date.now()
  const lockToken = newId('mlock')
  const [result] = await q(
    `UPDATE monitors
     SET lock_token = ?, locked_until = ?, status = IF(status = 'syncing', status, 'checking'), updated_at = ?
     WHERE id = ? AND user_id = ? AND enabled = 1
       AND (locked_until IS NULL OR locked_until < ?)`,
    [lockToken, now + ttlMs, now, id, userId, now]
  )
  if (!result.affectedRows) return null
  return getMonitor(userId, id)
}

export async function releaseMonitorLock(id, lockToken, patch = {}) {
  const { sets, params } = monitorPatchParts({ ...patch, lockToken: null, lockedUntil: null })
  sets.push('updated_at = ?')
  params.push(Date.now(), id, lockToken)
  await q(
    `UPDATE monitors SET ${sets.join(', ')} WHERE id = ? AND lock_token = ?`,
    params
  )
  return getMonitorById(id)
}

export async function listMonitorsAwaitingTask(limit = 50) {
  const [rows] = await q(
    `${MONITOR_SELECT}
     WHERE m.status = 'syncing' AND m.last_task_id IS NOT NULL
     ORDER BY m.updated_at ASC
     LIMIT ?`,
    [limit]
  )
  return rows.map(mapMonitor)
}

export async function findShareByTaskId(userId, taskId) {
  if (!taskId) return null
  const [rows] = await q(
    'SELECT * FROM shares WHERE user_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId, taskId]
  )
  return rows[0] ? mapShare(rows[0]) : null
}

// tasks
const mapTask = (r) => r && ({
  id: r.id,
  userId: r.user_id,
  kind: r.kind,
  title: r.title,
  detail: parse(r.detail, {}),
  status: r.status,
  progress: r.progress,
  logs: parse(r.logs, []),
  error: r.error,
  createdAt: r.created_at,
  finishedAt: r.finished_at
})

export async function insertTask(t) {
  await q(
    `INSERT INTO tasks (id, user_id, kind, title, detail, status, progress, logs, error, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.id, t.userId, t.kind, t.title, json(t.detail), t.status, t.progress, json(t.logs), t.error || null, t.createdAt, t.finishedAt || null]
  )
  return t
}

export async function patchTask(id, patch) {
  const map = { title: 'title', status: 'status', progress: 'progress', logs: 'logs', error: 'error', finishedAt: 'finished_at' }
  const sets = []
  const params = []
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) {
      sets.push(`${col} = ?`)
      params.push(k === 'logs' ? json(patch[k]) : patch[k])
    }
  }
  if (!sets.length) return
  params.push(id)
  await q(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, params)
}

export async function listTasks(userId, filters = {}) {
  const where = ['user_id = ?']
  const params = [userId]
  if (filters.kind) { where.push('kind = ?'); params.push(filters.kind) }
  if (filters.status) { where.push('status = ?'); params.push(filters.status) }
  if (filters.batchId) {
    where.push("JSON_UNQUOTE(JSON_EXTRACT(detail, '$.batchId')) = ?")
    params.push(filters.batchId)
  }
  params.push(Number(filters.limit || 60))
  const [rows] = await q(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, params)
  return rows.map(mapTask)
}

export async function getTask(userId, id) {
  const [rows] = await q('SELECT * FROM tasks WHERE id = ? AND user_id = ? LIMIT 1', [id, userId])
  return mapTask(rows[0])
}

export async function getTaskById(id) {
  const [rows] = await q('SELECT * FROM tasks WHERE id = ? LIMIT 1', [id])
  return mapTask(rows[0])
}

export async function removeTask(userId, id) {
  await q('DELETE FROM tasks WHERE id = ? AND user_id = ?', [id, userId])
}

export async function markTasksInterrupted() {
  await q("UPDATE tasks SET status = 'error', error = '服务重启,任务已中断', finished_at = ? WHERE status IN ('running','queued')", [Date.now()])
}

// shares
const mapShare = (r) => r && ({
  id: r.id,
  userId: r.user_id,
  accountId: r.account_id,
  provider: r.provider,
  batchId: r.batch_id,
  taskId: r.task_id,
  title: r.title,
  url: r.url,
  passcode: r.passcode,
  expires: r.expires,
  createdAt: r.created_at
})

export async function insertShare(s) {
  await q(
    `INSERT INTO shares
      (id, user_id, account_id, provider, batch_id, task_id, title, url, passcode, expires, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.id,
      s.userId,
      s.accountId || null,
      s.provider || null,
      s.batchId || null,
      s.taskId || null,
      s.title || null,
      s.url || null,
      s.passcode || null,
      s.expires ?? null,
      s.createdAt || Date.now()
    ]
  )
  return s
}

export async function listShares(userId, filters = {}) {
  const where = ['user_id = ?']
  const params = [userId]
  if (filters.batchId) {
    where.push('batch_id = ?')
    params.push(String(filters.batchId))
  }
  params.push(Number(filters.limit || 100))
  const [rows] = await q(
    `SELECT * FROM shares WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    params
  )
  return rows.map(mapShare)
}

export async function removeShare(userId, id) {
  await q('DELETE FROM shares WHERE id = ? AND user_id = ?', [id, userId])
}

// resources
const mapResource = (r) => r && ({
  id: r.id,
  userId: r.user_id,
  accountId: r.account_id,
  provider: r.provider,
  title: r.title,
  sourceUrl: r.source_url,
  sourceCode: r.source_code,
  savedPath: r.saved_path,
  taskId: r.task_id,
  batchId: r.batch_id,
  createdAt: r.created_at
})

export async function insertResource(r) {
  await q(
    `INSERT INTO resources
      (id, user_id, account_id, provider, title, source_url, source_code, saved_path, task_id, batch_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      r.id,
      r.userId,
      r.accountId || null,
      r.provider || null,
      r.title || null,
      r.sourceUrl || null,
      r.sourceCode || null,
      r.savedPath || null,
      r.taskId || null,
      r.batchId || null,
      r.createdAt || Date.now()
    ]
  )
  return r
}

export async function listResources(userId) {
  const [rows] = await q('SELECT * FROM resources WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [userId])
  return rows.map(mapResource)
}

export async function deleteResourceForAdmin(id) {
  await q('DELETE FROM resources WHERE id = ?', [id])
}

export async function listPublicResources({
  username = '',
  keyword = '',
  provider = '',
  page = 1,
  pageSize = 20
} = {}) {
  const where = ['u.public_transfers = 1', 's.url IS NOT NULL', "s.url <> ''"]
  const params = []
  where.push('(s.expires IS NULL OR s.expires <= 0 OR s.created_at + (s.expires * 86400000) > ?)')
  params.push(Date.now())
  if (username) {
    where.push('u.username = ?')
    params.push(username)
  }
  if (keyword) {
    const like = `%${keyword}%`
    where.push(`(
      s.title LIKE ? OR u.username LIKE ? OR s.url LIKE ? OR s.passcode LIKE ?
      OR r.source_url LIKE ? OR r.source_code LIKE ?
    )`)
    params.push(like, like, like, like, like, like)
  }
  if (provider) {
    where.push('s.provider = ?')
    params.push(provider)
  }
  const clause = `WHERE ${where.join(' AND ')}`
  const relation = `
    LEFT JOIN resources r ON r.id = (
      SELECT r2.id
      FROM resources r2
      WHERE r2.user_id = s.user_id
        AND (
          (s.task_id IS NOT NULL AND r2.task_id = s.task_id)
          OR
          (s.task_id IS NULL AND r2.provider <=> s.provider AND r2.title = s.title)
        )
      ORDER BY r2.created_at DESC
      LIMIT 1
    )`
  const [countRows] = await q(
    `SELECT COUNT(*) AS n
     FROM shares s
     JOIN users u ON u.id = s.user_id
     ${relation}
     ${clause}`,
    params
  )
  const offset = (page - 1) * pageSize
  const [rows] = await q(
    `SELECT
       s.id, s.title, s.provider, s.url, s.passcode, s.expires, s.created_at,
       u.username,
       r.source_url, r.source_code
     FROM shares s
     JOIN users u ON u.id = s.user_id
     ${relation}
     ${clause}
     ORDER BY s.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )
  return {
    total: Number(countRows[0]?.n || 0),
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      provider: row.provider,
      sourceUrl: row.source_url,
      sourceCode: row.source_code,
      shareUrl: row.url,
      sharePasscode: row.passcode || null,
      shareExpires: row.expires ?? null,
      username: row.username,
      createdAt: row.created_at
    }))
  }
}

// demo file tree
export async function getDemoTree(accountId) {
  const [rows] = await q('SELECT tree FROM demo_tree WHERE account_id = ? LIMIT 1', [accountId])
  return rows[0] ? parse(rows[0].tree, null) : null
}

export async function saveDemoTree(accountId, tree) {
  await q(
    'INSERT INTO demo_tree (account_id, tree, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE tree = VALUES(tree), updated_at = VALUES(updated_at)',
    [accountId, json(tree), Date.now()]
  )
}
