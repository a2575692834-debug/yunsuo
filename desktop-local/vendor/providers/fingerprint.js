import crypto from 'node:crypto'

function timestamp(value) {
  const number = Number(value || 0)
  if (Number.isFinite(number) && number !== 0) return Math.max(0, number)
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function stableItem(item = {}) {
  return {
    path: String(item.path || item.name || '').replace(/\/+/g, '/'),
    type: item.type === 'dir' ? 'dir' : 'file',
    size: Math.max(0, Number(item.size || 0)),
    mtime: timestamp(item.mtime)
  }
}

export function shareSignature(title, items = []) {
  const normalized = items
    .map(stableItem)
    .sort((a, b) => `${a.path}:${a.type}`.localeCompare(`${b.path}:${b.type}`))
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ title: String(title || ''), items: normalized }))
    .digest('hex')
}
