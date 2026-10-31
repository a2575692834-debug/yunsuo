import { clearSession } from './store.js'

async function request(method, path, body) {
  const headers = {}
  const token = localStorage.getItem('ys_token')
  if (token) headers.Authorization = 'Bearer ' + token
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    clearSession()
    location.reload()
    throw new Error(data.error || '请先登录')
  }
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),
  del: (path) => request('DELETE', path)
}
