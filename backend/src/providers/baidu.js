import { Provider } from './base.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125 Safari/537.36'
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
])

function networkCode(err) {
  return String(err?.cause?.code || err?.code || '')
}

function isTransientNetworkError(err) {
  const code = networkCode(err)
  return TRANSIENT_NETWORK_CODES.has(code) || /^terminated$/i.test(String(err?.message || ''))
}

function failedBeforeRequest(err) {
  const message = String(err?.cause?.message || err?.message || '')
  return /before secure TLS connection|socket hang up|connection (?:reset|refused)/i.test(message)
}

async function requestWithRetry(url, init = {}, attempts = 3) {
  const method = String(init.method || 'GET').toUpperCase()
  const safeToRetry = method === 'GET' || method === 'HEAD'
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetch(url, init)
    } catch (err) {
      lastError = err
      const canRetry = isTransientNetworkError(err) && (safeToRetry || failedBeforeRequest(err))
      if (!canRetry || attempt === attempts - 1) break
      await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)))
    }
  }
  if (isTransientNetworkError(lastError)) {
    throw Object.assign(new Error('百度网络连接中断，请稍后重试'), {
      status: 502,
      cause: lastError
    })
  }
  throw lastError
}

function cookiePairs(headers) {
  let values = []
  if (typeof headers.getSetCookie === 'function') {
    values = headers.getSetCookie()
  } else {
    const merged = headers.get('set-cookie') || ''
    values = merged ? merged.split(/,\s*(?=[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/) : []
  }
  return values.map((item) => String(item).split(';', 1)[0].trim()).filter(Boolean)
}

function mergeCookies(jar, headers) {
  for (const pair of cookiePairs(headers)) {
    const index = pair.indexOf('=')
    if (index <= 0) continue
    const name = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    if (name) jar.set(name, value)
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

function cookieJar(cookie) {
  const jar = new Map()
  for (const pair of String(cookie || '').split(';')) {
    const index = pair.indexOf('=')
    if (index <= 0) continue
    jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
  }
  return jar
}

function parseChannel(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return null
  }
}

function numberValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const number = Number(value)
    if (Number.isFinite(number) && number >= 0) return number
  }
  return null
}

function usageFrom(data) {
  const nodes = [data, data?.data, data?.result, data?.quota]
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const used = numberValue(node.used, node.use, node.used_size, node.usedSize)
    const total = numberValue(node.total, node.quota, node.capacity, node.total_size, node.totalSize)
    const free = numberValue(node.free, node.free_size, node.freeSize)
    const resolvedTotal = total ?? (used !== null && free !== null ? used + free : null)
    if (used !== null && resolvedTotal !== null && resolvedTotal > 0) {
      return { used, total: resolvedTotal }
    }
  }
  return null
}

function safeName(value, fallback = '转存内容') {
  const name = String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return name || fallback
}

function baiduSurl(value) {
  const key = String(value || '').trim()
  return key.startsWith('1') && key.length > 1 ? key.slice(1) : key
}

function readPageField(html, names) {
  for (const name of names) {
    const pattern = new RegExp(
      `(?:^|[,{])\\s*${name}\\s*:\\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_-]+))`
    )
    const match = String(html || '').match(pattern)
    const value = match?.[1] ?? match?.[2] ?? match?.[3]
    if (value !== undefined && value !== '') return value
  }
  return ''
}

function joinPath(base, name) {
  return `${String(base || '/').replace(/\/+$/, '')}/${name}` || '/'
}

function sharePasscode(value) {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized) {
    if (!/^[A-Z0-9]{4}$/.test(normalized)) {
      throw Object.assign(new Error('百度分享提取码需为 4 位字母或数字'), { status: 400 })
    }
    return normalized
  }
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 20; attempt++) {
    const generated = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    if (!/^(.)\1{3}$/.test(generated)) return generated
  }
  return 'YUN8'
}

function jsonp(text) {
  const a = text.indexOf('(')
  const b = text.lastIndexOf(')')
  const raw = a >= 0 && b > a ? text.slice(a + 1, b) : text
  return JSON.parse(raw || '{}')
}

export class BaiduProvider extends Provider {
  constructor() {
    super({ id: 'baidu', name: '百度网盘', qr: true, transfer: true, share: true, files: true, search: true })
    this.qrSessions = new Map()
  }

  request(url, init = {}) {
    return requestWithRetry(url, init)
  }

  headers(account, extra = {}) {
    return {
      Cookie: account.cookie || '',
      'User-Agent': UA,
      Referer: 'https://pan.baidu.com/',
      ...extra
    }
  }

  token(account) {
    const cookie = account.cookie || ''
    const m = cookie.match(/BDSTOKEN=([^;]+)/) || cookie.match(/STOKEN=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : ''
  }

  async qrStart() {
    const res = await this.request(`https://passport.baidu.com/v2/api/getqrcode?lp=pc&tpl=netdisk&apiver=v3&tt=${Date.now()}`, {
      headers: { 'User-Agent': UA, Referer: 'https://pan.baidu.com/' }
    })
    const data = await res.json()
    if (data.errno !== 0 || !data.sign) this.fail('获取百度二维码失败')
    const jar = new Map()
    mergeCookies(jar, res.headers)
    this.qrSessions.set(data.sign, { jar, createdAt: Date.now() })
    this.pruneQrSessions()
    const image = /^https?:\/\//i.test(data.imgurl) ? data.imgurl : `https://${data.imgurl}`
    return { token: data.sign, qrText: image, qrImage: image }
  }

  async qrPoll(token) {
    const session = this.qrSessions.get(token) || { jar: new Map(), createdAt: Date.now() }
    const jar = session.jar
    const callback = `bd__cbs__${Date.now()}`
    const res = await this.request(`https://passport.baidu.com/channel/unicast?channel_id=${encodeURIComponent(token)}&tpl=netdisk&apiver=v3&callback=${callback}&tt=${Date.now()}`, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://pan.baidu.com/',
        ...(jar.size ? { Cookie: cookieHeader(jar) } : {})
      }
    })
    mergeCookies(jar, res.headers)
    const data = jsonp(await res.text())
    if (Number(data.errno) !== 0) return { status: 'pending' }

    const channel = parseChannel(data.channel_v)
    if (!channel) return { status: 'pending' }
    const code = String(channel.v || '')
    if (Number(channel.status) === 0 && code) {
      const cookie = await this.exchangeLogin(code, jar)
      this.qrSessions.delete(token)
      return { status: 'confirmed', cookie, label: '百度账号' }
    }
    this.qrSessions.set(token, session)
    return { status: 'scanned' }
  }

  async exchangeLogin(code, baseJar) {
    const jar = new Map(baseJar)
    const login = await this.request(
      `https://passport.baidu.com/v3/login/main/qrbdusslogin?bduss=${encodeURIComponent(code)}&u=${encodeURIComponent('https://pan.baidu.com/disk/main')}&tpl=netdisk&apiver=v3&login_version=v5&tt=${Date.now()}`,
      {
        redirect: 'manual',
        headers: {
          'User-Agent': UA,
          Referer: 'https://pan.baidu.com/',
          ...(jar.size ? { Cookie: cookieHeader(jar) } : {})
        }
      }
    )
    mergeCookies(jar, login.headers)
    const cookie = cookieHeader(jar)
    if (!/(?:^|;\s*)BDUSS=/.test(cookie)) {
      this.fail('百度扫码已确认，但登录凭据换取失败，请刷新二维码重试')
    }
    try {
      return (await this.refreshSession({ cookie })).cookie
    } catch {
      // 网页会话可在后续获取容量或文件列表时继续补齐。
      return cookie
    }
  }

  async webToken(jar) {
    let lastError = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.request(
          'https://pan.baidu.com/api/gettemplatevariable?channel=chunlei&clienttype=0&web=1&app_id=250528&fields=%5B%22bdstoken%22%2C%22uk%22%2C%22username%22%5D',
          {
            headers: {
              'User-Agent': UA,
              Accept: 'application/json, text/plain, */*',
              Referer: 'https://pan.baidu.com/disk/main',
              Cookie: cookieHeader(jar)
            }
          }
        )
        const data = await res.json().catch(() => ({}))
        const result = data.result && typeof data.result === 'object' ? data.result : data
        return Number(data.errno) === 0 ? String(result.bdstoken || '').trim() : ''
      } catch (err) {
        lastError = err
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
        }
      }
    }
    throw lastError
  }

  async refreshSession(account) {
    this.needCookie(account)
    const jar = new Map()
    for (const pair of String(account.cookie).split(';')) {
      const index = pair.indexOf('=')
      if (index <= 0) continue
      jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }

    let bdstoken = await this.webToken(jar)
    if (!bdstoken) {
      let url = 'https://passport.baidu.com/v3/login/api/auth/?return_type=5&tpl=netdisk&u=https%3A%2F%2Fpan.baidu.com%2Fdisk%2Fhome'
      for (let step = 0; step < 8; step++) {
        const res = await this.request(url, {
          redirect: 'manual',
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: 'https://pan.baidu.com/',
            ...(jar.size ? { Cookie: cookieHeader(jar) } : {})
          }
        })
        mergeCookies(jar, res.headers)
        const location = res.headers.get('location')
        if (!location) {
          await res.arrayBuffer().catch(() => {})
          break
        }
        await res.arrayBuffer().catch(() => {})
        url = new URL(location, url).toString()
      }
      bdstoken = await this.webToken(jar)
    }

    if (!bdstoken) this.fail('百度网页会话初始化失败，请重新扫码登录')
    jar.set('BDSTOKEN', bdstoken)
    return { cookie: cookieHeader(jar), bdstoken }
  }

  pruneQrSessions() {
    const cutoff = Date.now() - 10 * 60 * 1000
    for (const [token, session] of this.qrSessions) {
      if (session.createdAt < cutoff) this.qrSessions.delete(token)
    }
  }

  async api(account, url, init = {}) {
    const res = await this.request(url, {
      ...init,
      headers: this.headers(account, init.headers || {})
    })
    const data = await res.json().catch(() => ({}))
    if (data.errno !== 0) {
      throw Object.assign(new Error(`百度接口返回异常: ${data.err_msg || data.errno || 'unknown'}`), { status: 400 })
    }
    return data
  }

  async fileManager(account, opera, filelist, extra = {}) {
    const query = new URLSearchParams({
      method: 'filemanager',
      opera,
      clienttype: '0',
      web: '1',
      app_id: '250528',
      bdstoken: this.token(account)
    })
    const data = await this.api(account, `https://pan.baidu.com/rest/2.0/xpan/file?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        async: '0',
        filelist: JSON.stringify(filelist),
        ondup: 'fail',
        ...extra
      })
    })
    const info = Array.isArray(data.info) ? data.info : []
    const failed = info.find((item) => Number(item?.errno || 0) !== 0)
    if (failed) {
      this.fail(`百度文件操作失败: ${failed.err_msg || failed.errno || '未知错误'}`)
    }
    return data
  }

  async list(account, path = '/') {
    this.needCookie(account)
    const data = await this.api(account,
      `https://pan.baidu.com/api/list?dir=${encodeURIComponent(path)}&bdstoken=${encodeURIComponent(this.token(account))}&channel=chunlei&web=1&app_id=250528&clienttype=0`
    )
    return (data.list || []).map((x) => ({
      name: x.server_filename,
      path: (path === '/' ? '' : path) + '/' + x.server_filename,
      type: x.isdir ? 'dir' : 'file',
      size: Number(x.size || 0),
      mtime: Number(x.server_mtime || 0) * 1000,
      fsId: x.fs_id
    }))
  }

  async search(account, keyword, options = {}) {
    this.needCookie(account)
    const limit = Math.max(1, Math.min(100, Number(options.limit || 50)))
    const query = new URLSearchParams({
      key: String(keyword || '').trim(),
      recursion: '1',
      page: '1',
      num: String(limit),
      order: 'time',
      desc: '1',
      showempty: '0',
      web: '1',
      bdstoken: this.token(account),
      channel: 'chunlei',
      app_id: '250528',
      clienttype: '0',
      dir: '/'
    })
    const data = await this.api(account, `https://pan.baidu.com/api/search?${query}`)
    return (data.list || []).slice(0, limit).map((item) => {
      const path = String(item.path || '')
      return {
        id: String(item.fs_id || ''),
        name: String(item.server_filename || path.split('/').pop() || ''),
        path,
        parentPath: path.split('/').slice(0, -1).join('/') || '/',
        type: item.isdir ? 'dir' : 'file',
        size: Number(item.size || 0),
        mtime: Number(item.server_mtime || item.server_ctime || 0) * 1000
      }
    })
  }

  async rename(account, path, newName) {
    this.needCookie(account)
    await this.fileManager(account, 'rename', [{ path, newname: newName }])
  }

  async remove(account, paths) {
    this.needCookie(account)
    await this.fileManager(account, 'delete', paths)
  }

  async copy(account, paths, destination) {
    this.needCookie(account)
    await this.fileManager(account, 'copy', paths.map((path) => ({
      path,
      dest: destination,
      newname: String(path).split('/').pop()
    })))
  }

  async move(account, paths, destination) {
    this.needCookie(account)
    await this.fileManager(account, 'move', paths.map((path) => ({
      path,
      dest: destination,
      newname: String(path).split('/').pop()
    })))
  }

  async mkdir(account, parent, name) {
    this.needCookie(account)
    const children = await this.list(account, parent)
    if (children.some((item) => item.name === name)) this.fail('同名文件或文件夹已存在')
    await this.ensureFolder(account, joinPath(parent, name))
  }

  async ensureFolder(account, path) {
    let current = '/'
    for (const name of String(path || '/').split('/').filter(Boolean)) {
      const rows = await this.list(account, current)
      let hit = rows.find((x) => x.type === 'dir' && x.name === name)
      if (!hit) {
        const next = joinPath(current, name)
        const token = encodeURIComponent(this.token(account))
        try {
          const created = await this.api(account,
            `https://pan.baidu.com/api/create?a=commit&channel=chunlei&web=1&app_id=250528&clienttype=0&bdstoken=${token}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ path: next, isdir: '1', block_list: '[]' })
            }
          )
          if (created.fs_id) {
            hit = { fsId: created.fs_id, type: 'dir', name }
          }
        } catch (err) {
          // 并发创建时目录可能已经存在,刷新一次再判断。
          const refreshed = await this.list(account, current)
          hit = refreshed.find((x) => x.type === 'dir' && x.name === name)
          if (!hit) throw err
        }
      }
      if (!hit) {
        const refreshed = await this.list(account, current)
        hit = refreshed.find((x) => x.type === 'dir' && x.name === name)
      }
      if (!hit) this.fail(`无法创建百度目录: ${current}/${name}`)
      current = joinPath(current, name)
    }
    return current
  }

  async transferFolder(account, targetPath, desiredName) {
    await this.ensureFolder(account, targetPath)
    const children = await this.list(account, targetPath)
    const base = safeName(desiredName)
    let name = base
    for (let i = 2; i < 100 && children.some((x) => x.name === name); i++) {
      name = `${base} (${i})`
    }
    const path = joinPath(targetPath, name)
    await this.ensureFolder(account, path)
    return path
  }

  async usage(account) {
    this.needCookie(account)
    const bdstoken = encodeURIComponent(this.token(account))
    const urls = [
      `https://pan.baidu.com/api/quota?checkfree=1&checkexpire=1&bdstoken=${bdstoken}&channel=chunlei&web=1&app_id=250528&clienttype=0`,
      'https://pcs.baidu.com/rest/2.0/pcs/quota?app_id=250528&method=info'
    ]
    for (const url of urls) {
      try {
        const res = await this.request(url, { headers: this.headers(account) })
        const data = await res.json()
        const usage = usageFrom(data)
        if (usage) return usage
      } catch {
        // 尝试下一个额度接口。
      }
    }
    return null
  }

  async transfer(account, link, passcode, targetPath = '/') {
    this.needCookie(account)
    const surl = baiduSurl(link.key)
    if (!surl) this.fail('百度分享链接格式不正确')
    const jar = cookieJar(account.cookie)
    let activeAccount = { ...account, cookie: cookieHeader(jar) }

    const init = await this.request(`https://pan.baidu.com/share/init?surl=${surl}`, { headers: this.headers(activeAccount) })
    mergeCookies(jar, init.headers)
    activeAccount = { ...account, cookie: cookieHeader(jar) }
    let html
    try {
      html = await init.text()
    } catch {
      this.fail('百度分享页读取失败,请稍后重试')
    }
    const shareid = readPageField(html, ['shareid', 'share_id'])
    const uk = readPageField(html, ['share_uk'])
    const pageToken = readPageField(html, ['bdstoken'])
    if (!shareid || !uk) this.fail('百度分享信息不完整')

    const verifyQuery = new URLSearchParams({
      shareid,
      time: String(Date.now()),
      clienttype: '1',
      uk
    })
    const verify = await this.request(`https://pan.baidu.com/share/verify?${verifyQuery}`, {
      method: 'POST',
      headers: this.headers(activeAccount, {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: link.url
      }),
      body: new URLSearchParams({
        pwd: passcode || '',
        vcode: 'null',
        vcode_str: 'null',
        bdstoken: pageToken || this.token(account)
      })
    })
    mergeCookies(jar, verify.headers)
    activeAccount = { ...account, cookie: cookieHeader(jar) }
    const vdata = await verify.json()
    if (vdata.errno !== 0) this.fail('百度提取码校验失败: ' + (vdata.err_msg || vdata.errno))
    const randsk = vdata.randsk || ''

    const listData = await this.api(activeAccount,
      `https://pan.baidu.com/share/list?shareid=${shareid}&from=0&sekey=&channel=chunlei&web=5&app_id=250528&clienttype=0&_=${Date.now()}&root=1&shorturl=${surl}&surl=${surl}&uk=${uk}&randsk=${encodeURIComponent(randsk)}&bdstoken=${encodeURIComponent(pageToken || this.token(activeAccount))}`,
      { headers: { Referer: link.url } }
    )
    const files = listData.list || []
    const fsIds = files.map((x) => x.fs_id).filter(Boolean)
    if (!fsIds.length) this.fail('分享中没有可转存的文件')
    const sourceName = safeName(
      (files.length === 1 ? files[0].server_filename : '') ||
      readPageField(html, ['server_filename', 'filename', 'share_name']) ||
      link.key,
      link.key
    )
    const jobPath = await this.transferFolder(activeAccount, targetPath, sourceName)

    const transferQuery = new URLSearchParams({
      shareid,
      from: uk,
      channel: 'chunlei',
      web: '1',
      app_id: '250528',
      clienttype: '0',
      bdstoken: pageToken || this.token(activeAccount)
    })
    const transfer = await this.request(
      `https://pan.baidu.com/share/transfer?${transferQuery}`,
      {
        method: 'POST',
        headers: this.headers(activeAccount, {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: link.url
        }),
        body: new URLSearchParams({
          fsidlist: JSON.stringify(fsIds),
          path: jobPath
        })
      }
    )
    const tdata = await transfer.json()
    if (tdata.errno !== 0) this.fail('百度转存失败: ' + (tdata.err_msg || tdata.errno))
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
    for (const path of paths) {
      const parent = String(path).split('/').slice(0, -1).join('/') || '/'
      const name = String(path).split('/').pop()
      const rows = await this.list(account, parent)
      const hit = rows.find((x) => x.name === name)
      if (hit?.fsId) ids.push(hit.fsId)
    }
    if (!ids.length) this.fail('未找到要分享的百度文件')

    // 百度网页分享接口始终要求 4 位提取码；留空时自动生成并随结果返回。
    const passcode = sharePasscode(opts.passcode)
    const query = new URLSearchParams({
      channel: 'chunlei',
      clienttype: '0',
      web: '1',
      app_id: '250528',
      bdstoken: this.token(account)
    })
    const res = await this.request(`https://pan.baidu.com/share/set?${query}`, {
      method: 'POST',
      headers: this.headers(account, { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({
        fid_list: JSON.stringify(ids),
        schannel: '4',
        channel_list: '[]',
        period: String(days),
        pwd: passcode
      })
    })
    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      this.fail(`百度创建分享失败: 接口返回异常 (HTTP ${res.status})`)
    }
    if (Number(data.errno) !== 0) {
      const message = data.show_msg || data.err_msg || data.errno || '未知错误'
      this.fail(`百度创建分享失败: ${message}`)
    }
    const url = String(data.shorturl || data.link || '').trim()
    if (!url) this.fail('百度分享已创建，但没有返回分享链接')
    return {
      shareId: data.shareid || data.share_id || null,
      url,
      passcode,
      expires: days
    }
  }
}
