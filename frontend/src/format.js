export function fmtBytes(n) {
  n = Number(n || 0)
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB'
  return n + ' B'
}

export function fmtDate(ts) {
  if (!ts) return '—'
  const d = new Date(Number(ts))
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false })
}

export function pct(used, total) {
  if (!total) return 0
  return Math.min(100, Math.round((Number(used) / Number(total)) * 100))
}
