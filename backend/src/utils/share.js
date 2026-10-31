export function resolveShareExpiry(body = {}) {
  if (body.unlimited === true || (body.unlimited === undefined && body.expires == null)) {
    return { unlimited: true, expires: 0 }
  }

  const requested = Number(body.expires ?? 7)
  const expires = Number.isFinite(requested)
    ? Math.min(3650, Math.max(1, Math.trunc(requested)))
    : 7
  return { unlimited: false, expires }
}

export function resolveSharePasscode(value, provider = '') {
  // Quark links are intentionally open. A batch-wide passcode only applies
  // to providers that support one, such as Baidu and Xunlei.
  if (provider === 'quark') return ''
  return String(value === undefined ? '8888' : value || '').trim().toUpperCase()
}
