import QRCode from 'qrcode'
import { randomBytes, randomUUID } from 'node:crypto'
import { Provider } from './base.js'
import { shareSignature } from './fingerprint.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125 Safari/537.36'
const CLIENT_ID = 'XW5SkOhLDjnOZP7J'
const LOGIN_ORIGIN = 'https://i.xunlei.com'

function safeName(value, fallback = '转存内容') {
  const name = String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return name || fallback
}

function joinPath(base, name) {
  return `${String(base || '/').replace(/\/+$/, '')}/${name}` || '/'
}

// 迅雷接口为社区逆向整理,端点可能随官方调整;扫码登录与手动 Cookie 均保留。
export class XunleiProvider extends Provider {
  constructor() {
    super({ id: 'xunlei', name: '迅雷网盘', qr: true, transfer: true, share: true, files: true, search: true })
  }

  headers(account, extra = {}) {
    return {
      Cookie: account.cookie || '',
      'User-Agent': UA,
      Referer: 'https://pan.xunlei.com/',
      Origin: 'https://pan.xunlei.com',
      ...extra
    }
  }

  async api(account, url, init = {}) {
    const res = await fetch(url, {
      ...init,
      headers: this.headers(account, {
        'Content-Type': 'application/json',
        ...(init.headers || {})
      })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || (data.error && data.error.code)) {
      throw Object.assign(new Error(`迅雷接口返回异常: ${data.error?.message || data.error_description || res.status}`), { status: 400 })
    }
    return data
  }

  loginHeaders(extra = {}) {
    return {
      'User-Agent': UA,
      Origin: LOGIN_ORIGIN,
      Referer: `${LOGIN_ORIGIN}/`,
      ...extra
    }
  }

  async readJson(res) {
    const text = await res.text()
    try {
      return text ? JSON.parse(text) : {}
    } catch {
      return { error_description: text.slice(0, 200) }
    }
  }

  deviceSign() {
    return `wdi10.${randomBytes(32).toString('hex')}`
  }

  async registerSession(accessToken) {
    const params = new URLSearchParams({
      appid: '22003',
      token: accessToken,
      appname: 'WEB-i.xunlei.com',
      devicesign: this.deviceSign()
    })
    const res = await fetch(`https://xluser-ssl.xunlei.com/session/v1/register?${params}`, {
      headers: this.loginHeaders({ Accept: 'application/json' })
    })
    const data = await this.readJson(res)
    if (!res.ok) {
      this.fail(`迅雷登录会话创建失败: ${data.error_description || data.error || res.status}`)
    }

    const sessionId = data.sessionid || data.session_id
    const userId = data.user_id || data.userid || data.sub
    const loginKey = data.loginkey || data.login_key
    if (!sessionId) this.fail('迅雷登录成功,但未取得 sessionid')

    const parts = [
      `sessionid=${sessionId}`,
      userId ? `userid=${userId}` : '',
      loginKey ? `loginkey=${loginKey}` : ''
    ].filter(Boolean)
    const setCookie = (res.headers.getSetCookie?.() || [])
      .map((x) => x.split(';')[0])
      .filter(Boolean)
    for (const item of setCookie) {
      const name = item.split('=')[0]
      if (!parts.some((x) => x.startsWith(`${name}=`))) parts.push(item)
    }
    return {
      cookie: parts.join('; '),
      label: data.nickname || data.username || data.email || '迅雷账号'
    }
  }

  async qrStart() {
    const res = await fetch('https://xluser-ssl.xunlei.com/v1/auth/device/code', {
      method: 'POST',
      headers: this.loginHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_id: randomUUID(),
        scope: 'profile offline pan sso user',
        meta: { ui_client_key: 'default' }
      })
    })
    const data = await this.readJson(res)
    if (!res.ok || !data.device_code || !data.verification_uri_complete) {
      this.fail('获取迅雷二维码失败: ' + (data.error_description || data.error || res.status))
    }

    // 官方登录器的二维码外层地址,内部承载返回到 xnlogin 的完整授权地址。
    const loginUrl = data.verification_uri_complete
    const url = `https://xluser-ssl.xunlei.com/xluser.core.login/v3/qrlogin?redirect_uri=${encodeURIComponent(loginUrl)}`
    return {
      token: data.device_code,
      qrText: url,
      qrImage: await QRCode.toDataURL(url, {
        width: 300,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#101822', light: '#ffffff' }
      }),
      expiresIn: Number(data.expires_in || 120),
      interval: Number(data.interval || 2)
    }
  }

  async qrPoll(token) {
    const res = await fetch('https://xluser-ssl.xunlei.com/v1/auth/token', {
      method: 'POST',
      headers: this.loginHeaders({
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: CLIENT_ID,
        device_code: token
      })
    })
    const data = await this.readJson(res)
    const error = String(data.error || '')

    if (res.ok && data.access_token) {
      const session = await this.registerSession(data.access_token)
      return { status: 'confirmed', ...session }
    }

    if (['authorization_pending', 'slow_down'].includes(error) || data.error_code === 4050) {
      return { status: 'pending' }
    }
    if (['expired_token', 'access_denied'].includes(error) || data.error_code === 4052) {
      return { status: 'expired' }
    }
    if (!res.ok) {
      this.fail(`迅雷扫码状态查询失败: ${data.error_description || data.error || res.status}`)
    }
    return { status: 'pending' }
  }

  async list(account, path = '/') {
    this.needCookie(account)
    const parentId = path === '/' ? '' : await this.fileId(account, path)
    const data = await this.api(account,
      `https://api-pan.xunlei.com/drive/v1/files?parent_id=${encodeURIComponent(parentId)}&page_token=&with_audit=true&thumbnail_size=SIZE_SMALL&limit=100`
    )
    return (data.files || []).map((x) => ({
      name: x.name,
      path: (path === '/' ? '' : path) + '/' + x.name,
      type: x.kind === 'drive#folder' ? 'dir' : 'file',
      size: Number(x.size || 0),
      mtime: Number(x.modified_time || x.created_time || 0),
      fileId: x.id
    }))
  }

  async fileId(account, path) {
    const names = String(path).split('/').filter(Boolean)
    let parentId = ''
    let current = '/'
    for (const name of names) {
      const rows = await this.list(account, current)
      const hit = rows.find((x) => x.name === name)
      if (!hit) this.fail(`迅雷路径不存在: ${current}/${name}`)
      parentId = hit.fileId
      current = current === '/' ? '/' + name : current + '/' + name
    }
    return parentId
  }

  userId(account) {
    const hit = String(account.cookie || '').match(/(?:^|;\s*)userid=([^;]+)/i)
    return hit ? decodeURIComponent(hit[1]) : ''
  }

  async ancestorPath(account, parentId) {
    if (!parentId) return '/'
    try {
      const data = await this.api(account,
        `https://api-pan.xunlei.com/drive/v1/file/ancestors?file_id=${encodeURIComponent(parentId)}`
      )
      const list = data.ancestors || data.files || data.data?.ancestors || data.data?.files || []
      const names = list
        .slice()
        .sort((a, b) => Number(a.depth ?? 0) - Number(b.depth ?? 0))
        .map((item) => String(item.name || '').trim())
        .filter(Boolean)
      return '/' + names.join('/')
    } catch {
      return '/'
    }
  }

  async search(account, keyword, options = {}) {
    this.needCookie(account)
    const limit = Math.max(1, Math.min(100, Number(options.limit || 50)))
    const query = new URLSearchParams({
      keyword: String(keyword || '').trim(),
      limit: String(limit),
      space: '*',
      user_id: this.userId(account),
      parent_id: '',
      page_token: ''
    })
    const data = await this.api(account,
      `https://api-gateway-pan.xunlei.com/xlppc.searcher.api/drive_file_search?${query}`
    )
    if (data.code !== undefined && Number(data.code) !== 0) {
      this.fail(`迅雷搜索失败: ${data.message || data.msg || data.code}`)
    }
    const files = data.data?.files || data.files || []
    return Promise.all(files.slice(0, limit).map(async (item) => {
      const parentId = String(item.parent_id || item.parentId || '')
      const parentPath = String(item.parent_path || item.parentPath || '') || await this.ancestorPath(account, parentId)
      const name = String(item.name || item.file_name || '')
      return {
        id: String(item.id || item.file_id || ''),
        name,
        path: `${parentPath === '/' ? '' : parentPath}/${name}` || '/',
        parentPath,
        type: item.kind === 'drive#folder' || item.dir ? 'dir' : 'file',
        size: Number(item.size || 0),
        mtime: Number(item.modified_time || item.updated_at || item.created_at || 0)
      }
    }))
  }

  async rename(account, path, newName) {
    this.needCookie(account)
    const fileId = await this.fileId(account, path)
    await this.api(account, `https://api-pan.xunlei.com/drive/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: newName })
    })
  }

  async remove(account, paths) {
    this.needCookie(account)
    for (const path of paths) {
      const fileId = await this.fileId(account, path)
      await this.api(account, `https://api-pan.xunlei.com/drive/v1/files/${encodeURIComponent(fileId)}/trash`, {
        method: 'PATCH',
        body: JSON.stringify({})
      })
    }
  }

  async batchTransfer(account, paths, destination, operation) {
    this.needCookie(account)
    const ids = []
    for (const path of paths) ids.push(await this.fileId(account, path))
    const parentId = destination === '/' ? '' : await this.fileId(account, destination)
    await this.api(account, `https://api-pan.xunlei.com/drive/v1/files:${operation}`, {
      method: 'POST',
      body: JSON.stringify({
        ids,
        to: { parent_id: parentId }
      })
    })
  }

  async copy(account, paths, destination) {
    await this.batchTransfer(account, paths, destination, 'batchCopy')
  }

  async move(account, paths, destination) {
    await this.batchTransfer(account, paths, destination, 'batchMove')
  }

  async mkdir(account, parent, name) {
    this.needCookie(account)
    const children = await this.list(account, parent)
    if (children.some((item) => item.name === name)) this.fail('同名文件或文件夹已存在')
    const parentId = parent === '/' ? '' : await this.fileId(account, parent)
    await this.api(account, 'https://api-pan.xunlei.com/drive/v1/files', {
      method: 'POST',
      body: JSON.stringify({ kind: 'drive#folder', name, parent_id: parentId })
    })
  }

  async ensureFolder(account, path) {
    let parentId = ''
    let current = '/'
    for (const name of String(path || '/').split('/').filter(Boolean)) {
      const children = await this.list(account, current)
      let hit = children.find((x) => x.type === 'dir' && x.name === name)
      if (!hit) {
        const created = await this.api(account, 'https://api-pan.xunlei.com/drive/v1/files', {
          method: 'POST',
          body: JSON.stringify({ kind: 'drive#folder', name, parent_id: parentId })
        })
        const newId = created.file?.id || created.id
        if (newId) {
          hit = { fileId: String(newId), type: 'dir', name }
        } else {
          const refreshed = await this.list(account, current)
          hit = refreshed.find((x) => x.type === 'dir' && x.name === name)
        }
      }
      if (!hit) this.fail(`无法创建迅雷目录: ${current}/${name}`)
      parentId = String(hit.fileId)
      current = joinPath(current, name)
    }
    return parentId
  }

  async transferFolder(account, targetPath, desiredName, reuseExisting = false) {
    await this.ensureFolder(account, targetPath)
    const children = await this.list(account, targetPath)
    const base = safeName(desiredName)
    if (reuseExisting) {
      const existing = children.find((x) => x.name === base)
      if (existing && existing.type !== 'dir') {
        this.fail(`无法同步到固定目录: ${joinPath(targetPath, base)} 已被同名文件占用`)
      }
      const path = joinPath(targetPath, base)
      await this.ensureFolder(account, path)
      return path
    }
    let name = base
    for (let i = 2; i < 100 && children.some((x) => x.name === name); i++) {
      name = `${base} (${i})`
    }
    const path = joinPath(targetPath, name)
    await this.ensureFolder(account, path)
    return path
  }

  async usage(account) {
    try {
      const data = await this.api(account, 'https://api-pan.xunlei.com/drive/v1/about')
      const quota = data.quota || {}
      return { used: Number(quota.used_size || 0), total: Number(quota.size || 0) }
    } catch {
      return null
    }
  }

  async shareContext(account, link, passcode) {
    this.needCookie(account)
    const shareId = link.key
    const info = await this.api(account,
      `https://api-pan.xunlei.com/drive/v1/share?share_id=${encodeURIComponent(shareId)}&pass_code=${encodeURIComponent(passcode || '')}`
    )
    const files = info.share?.files || info.files || []
    if (!files.length) this.fail('迅雷分享中没有可转存的文件')
    const sourceName = safeName(
      info.share?.title || (files.length === 1 ? files[0].name : '') || link.key,
      link.key
    )
    return { shareId, info, files, sourceName }
  }

  async inspectShare(account, link, passcode) {
    const context = await this.shareContext(account, link, passcode)
    const items = context.files.slice(0, 2000).map((item) => {
      const name = String(item.name || item.file_name || '未命名')
      return {
        name,
        path: String(item.path || item.file_path || `/${name}`).replace(/\/+/g, '/'),
        type: item.kind === 'drive#folder' || item.dir ? 'dir' : 'file',
        size: Number(item.size || 0),
        mtime: Number(item.modified_time || item.updated_at || item.created_at || 0)
      }
    })
    return {
      title: context.sourceName,
      signature: shareSignature(context.sourceName, items),
      items
    }
  }

  async transfer(account, link, passcode, targetPath = '/') {
    const context = await this.shareContext(account, link, passcode)
    const { shareId, files, sourceName } = context
    const ids = files.map((x) => x.id || x.file_id).filter(Boolean)
    if (!ids.length) this.fail('迅雷分享中没有可转存的文件')
    const jobPath = await this.transferFolder(
      account,
      targetPath,
      sourceName,
      link.syncMode === true
    )
    const parentId = await this.fileId(account, jobPath)
    await this.api(account, 'https://api-pan.xunlei.com/drive/v1/share/transfer', {
      method: 'POST',
      body: JSON.stringify({
        share_id: shareId,
        pass_code: passcode || '',
        parent_id: parentId,
        file_ids: ids
      })
    })
    return { sourceName, savedPaths: [jobPath] }
  }

  async share(account, paths, opts = {}) {
    this.needCookie(account)
    const requestedDays = Number(opts.expires)
    const days = opts.unlimited || requestedDays === 0
      ? 0
      : Number.isFinite(requestedDays) && requestedDays > 0
        ? Math.trunc(requestedDays)
        : 7
    const ids = []
    for (const path of paths) ids.push(await this.fileId(account, path))
    if (!ids.length) this.fail('未找到要分享的迅雷文件')
    const data = await this.api(account, 'https://api-pan.xunlei.com/drive/v1/share', {
      method: 'POST',
      body: JSON.stringify({
        file_ids: ids,
        share_to: 'all',
        expiration_days: days,
        pass_code: opts.passcode || ''
      })
    })
    const raw = data.share_url || data.share?.share_url || ''
    const url = raw.startsWith('http') ? raw : (raw ? `https://pan.xunlei.com/s/${raw}` : '')
    return { url, passcode: opts.passcode || '', expires: days }
  }
}
