export function defaultTargetPath(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `/转存/${value.year}-${value.month}-${value.day}`
}

export function normalizeTargetPath(value, fallback = defaultTargetPath()) {
  let path = String(value || fallback).trim().replace(/\\/g, '/')
  if (!path) path = '/'
  if (!path.startsWith('/')) path = '/' + path
  path = path.replace(/\/+/g, '/').replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts.includes('..') || /[\0:*?"<>|]/.test(path)) return null
  return (path || '/').slice(0, 200)
}
