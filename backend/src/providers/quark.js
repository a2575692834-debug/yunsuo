import QRCode from 'qrcode'
import crypto from 'node:crypto'
import { Provider } from './base.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125 Safari/537.36'
const CLIENT_ID = '532'
const QR_WAITING_CODES = new Set([50004001, 80005000, 80005001, 80005002])
const QR_EXPIRED_CODES = new Set([50004002, 80005003, 80005004])

function requestId() {
  return crypto.randomBytes(16).toString('hex')
}

function cookiePairs(headers) {
  let values = []
  if (typeof headers.getSetCookie === 'function') {
    values = headers.getSetCookie()
  } else {
    const merged = headers.get('set-cookie') || ''
    // Set-Cookie 的 Expires 里也有逗号，只在“逗号 + 新 Cookie 名”处切分。
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

function hasSessionCookie(cookie) {
  return /(?:^|;\s*)(?:__puus|__pus)=/i.test(cookie || '')
}

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

function timestamp(value) {
  const number = Number(value || 0)
  if (!number) return 0
  return number < 1e12 ? number * 1000 : number
}

function isFolderConflict(error) {
  return /23008|同名冲突|doloading/i.test(String(error?.message || ''))
}

export class QuarkProvider extends Provider {
  constructor() {
    super({ id: 'quark', name: '夸克网盘', qr: true, transfer: true, share: true, files: true, copy: false, search: true })
  }

  headers(account, extra = {}) {
    return {
      Cookie: account.cookie || '',
      'User-Agent': UA,
      'Content-Type': 'application/json',
      ...extra
    }
  }

  fileEndpoint(extra = {}) {
    const search = new URLSearchParams({ pr: 'ucpro', fr: 'pc', uc_param_str: '', ...extra })
    return 'https://drive-pc.quark.cn/1/clouddrive/file?' + search
  }

  saveEndpoint(extra = {}) {
    const search = new URLSearchParams({ pr: 'ucpro', fr: 'pc', uc_param_str: '', ...extra })
    return 'https://drive-pc.quark.cn/1/clouddrive/share/sharepage/save?' + search
  }

  async call(account, method, url, body) {
    const res = await fetch(url, {
      method,
      headers: this.headers(account),
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (data.code !== 0) {
      const detail = data.message || data.msg || data.error || JSON.stringify(data).slice(0, 120)
      const code = data.code !== undefined ? ` (${data.code})` : ''
      throw Object.assign(new Error(`夸克接口返回异常${code}: ${detail || '未知错误'}`), { status: 400 })
    }
    return data
  }

  shareEndpoint(extra = {}) {
    const search = new URLSearchParams({ pr: 'ucpro', fr: 'pc', uc_param_str: '', ...extra })
    return 'https://drive-pc.quark.cn/1/clouddrive/share?' + search
  }

  taskEndpoint(extra = {}) {
    const search = new URLSearchParams({ pr: 'ucpro', fr: 'pc', uc_param_str: '', ...extra })
    return 'https://drive-pc.quark.cn/1/clouddrive/task?' + search
  }

  async folderId(account, path) {
    const list = String(path || '/').split('/').filter(Boolean)
    let fid = '0'
    let current = '/'
    for (const name of list) {
      const children = await this.list(account, current)
      const hit = children.find((x) => x.type === 'dir' && x.name === name)
      if (!hit) this.fail(`夸克目录不存在: ${current}/${name}`)
      fid = hit.fid
      current = current === '/' ? '/' + name : current + '/' + name
    }
    return fid
  }

  async ensureFolder(account, path) {
    const list = String(path || '/').split('/').filter(Boolean)
    let fid = '0'
    let current = '/'
    for (const name of list) {
      // Resolve each level directly by its parent fid. Re-resolving the whole
      // path can race Quark's shortly-delayed directory listing after creation.
      const children = await this.listByFid(account, fid, current)
      let hit = children.find((x) => x.type === 'dir' && x.name === name)
      if (!hit) {
        try {
          const created = await this.call(account, 'POST', this.fileEndpoint(), {
            pdir_fid: fid,
            file_name: name,
            dir_path: '',
            dir_init_lock: false
          })
          const newFid = created.data?.fid
          if (newFid) {
            hit = { fid: String(newFid), type: 'dir', name }
          } else {
            hit = await this.waitForFolder(account, fid, current, name)
          }
        } catch (error) {
          if (!isFolderConflict(error)) throw error
          // A previous click or a concurrent request may have created the
          // folder even though Quark has not exposed it in the listing yet.
          hit = await this.waitForFolder(account, fid, current, name)
        }
      }
      if (!hit) this.fail(`无法创建夸克目录: ${current}/${name}`)
      fid = String(hit.fid)
      current = current === '/' ? '/' + name : current + '/' + name
    }
    return fid
  }

  async waitForFolder(account, parentFid, parentPath, name) {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
      const children = await this.listByFid(account, parentFid, parentPath)
      const hit = children.find((item) => item.type === 'dir' && item.name === name)
      if (hit) return hit
    }
    return null
  }

  async transferFolder(account, targetPath, desiredName) {
    const parentFid = await this.ensureFolder(account, targetPath)
    const children = await this.listByFid(account, parentFid, targetPath)
    let name = safeName(desiredName)
    for (let i = 2; i < 100 && children.some((x) => x.name === name); i++) {
      name = `${safeName(desiredName)} (${i})`
    }
    const path = joinPath(targetPath, name)
    const fid = await this.ensureFolder(account, path)
    return { path, fid }
  }

  async list(account, path = '/') {
    this.needCookie(account)
    const fid = path === '/' ? '0' : await this.folderId(account, path)
    return this.listByFid(account, fid, path)
  }

  async listByFid(account, fid, path = '/') {
    this.needCookie(account)
    const files = []
    let page = 1
    for (;;) {
      const data = await this.call(account, 'GET', 'https://drive-pc.quark.cn/1/clouddrive/file/sort?' + new URLSearchParams({
        pr: 'ucpro',
        fr: 'pc',
        uc_param_str: '',
        pdir_fid: fid,
        _page: page,
        _size: 100,
        _fetch_total: 1,
        _fetch_sub_dirs: 0,
        _sort: 'file_type:asc,updated_at:desc'
      }))
      const list = data.data?.list || []
      for (const item of list) {
        files.push({
          name: item.file_name,
          fid: item.fid,
          type: item.dir ? 'dir' : 'file',
          size: Number(item.size || 0),
          mtime: timestamp(item.updated_at || item.created_at)
        })
      }
      const total = Number(data.metadata?._total ?? data.metadata?.total ?? 0)
      if (!list.length || files.length >= total) break
      page++
    }
    return files.map((f) => ({
      ...f,
      path: (path === '/' ? '' : path) + '/' + f.name
    }))
  }

  async itemId(account, path) {
    const parent = String(path).split('/').slice(0, -1).join('/') || '/'
    const name = String(path).split('/').pop()
    const children = await this.list(account, parent)
    const hit = children.find((item) => item.name === name)
    if (!hit) this.fail(`夸克路径不存在: ${path}`)
    return hit.fid
  }

  async fileInfo(account, fid) {
    const data = await this.call(account, 'GET',
      'https://drive-pc.quark.cn/1/clouddrive/file?' + new URLSearchParams({
        pr: 'ucpro',
        fr: 'pc',
        fids: String(fid)
      }))
    const items = data.data?.list || []
    return items.find((item) => String(item.fid) === String(fid)) || items[0] || null
  }

  async folderPath(account, fid, cache = new Map()) {
    const key = String(fid || '0')
    if (key === '0') return '/'
    if (cache.has(key)) return cache.get(key)
    const parts = []
    let current = key
    const visited = new Set()
    for (let depth = 0; current && current !== '0' && depth < 16; depth++) {
      if (visited.has(current)) break
      visited.add(current)
      const info = await this.fileInfo(account, current)
      if (!info) break
      parts.unshift(String(info.file_name || '').trim())
      current = String(info.pdir_fid || '0')
    }
    const path = '/' + parts.filter(Boolean).join('/')
    cache.set(key, path)
    return path
  }

  async search(account, keyword, options = {}) {
    this.needCookie(account)
    const limit = Math.max(1, Math.min(100, Number(options.limit || 50)))
    const data = await this.call(account, 'GET',
      'https://drive-pc.quark.cn/1/clouddrive/file/search?' + new URLSearchParams({
        pr: 'ucpro',
        fr: 'pc',
        q: String(keyword || '').trim(),
        _page: '1',
        _size: String(limit),
        _fetch_total: '1',
        _sort: 'file_type:desc,updated_at:desc',
        _is_hl: '1'
      }))
    const items = (data.data?.list || []).slice(0, limit)
    const cache = new Map([['0', '/']])
    const out = []
    for (const item of items) {
      const parentPath = await this.folderPath(account, item.pdir_fid, cache)
      const name = String(item.file_name || '')
      out.push({
        id: String(item.fid || ''),
        name,
        path: `${parentPath === '/' ? '' : parentPath}/${name}` || '/',
        parentPath,
        type: item.dir ? 'dir' : 'file',
        size: Number(item.size || 0),
        mtime: timestamp(item.updated_at || item.created_at)
      })
    }
    return out
  }

  async finishOperation(account, data, action) {
    const taskId = data?.data?.task_id
    if (taskId) await this.waitTask(account, taskId, action)
    return data
  }

  async rename(account, path, newName) {
    this.needCookie(account)
    const fid = await this.itemId(account, path)
    const data = await this.call(account, 'POST',
      'https://drive-pc.quark.cn/1/clouddrive/file/rename?pr=ucpro&fr=pc&uc_param_str=',
      { fid, file_name: newName }
    )
    await this.finishOperation(account, data, '重命名')
  }

  async remove(account, paths) {
    this.needCookie(account)
    const fids = []
    for (const path of paths) fids.push(await this.itemId(account, path))
    const data = await this.call(account, 'POST',
      'https://drive-pc.quark.cn/1/clouddrive/file/delete?pr=ucpro&fr=pc&uc_param_str=',
      { action_type: 2, filelist: fids, exclude_fids: [] }
    )
    await this.finishOperation(account, data, '删除')
  }

  async move(account, paths, destination) {
    this.needCookie(account)
    const filelist = []
    for (const path of paths) filelist.push(await this.itemId(account, path))
    const toPdirFid = await this.folderId(account, destination)
    const data = await this.call(account, 'POST',
      'https://drive-pc.quark.cn/1/clouddrive/file/move?pr=ucpro&fr=pc&uc_param_str=',
      {
        action_type: 1,
        filelist,
        to_pdir_fid: toPdirFid,
        exclude_fids: []
      }
    )
    await this.finishOperation(account, data, '移动')
  }

  async mkdir(account, parent, name) {
    this.needCookie(account)
    const children = await this.list(account, parent)
    if (children.some((item) => item.name === name)) this.fail('同名文件或文件夹已存在')
    await this.ensureFolder(account, joinPath(parent, name))
  }

  async usage(account) {
    try {
      const data = await this.call(account, 'GET',
        'https://drive-pc.quark.cn/1/clouddrive/member?pr=ucpro&fr=pc&uc_param_str=')
      const m = data.data || {}
      const used = Number(m.use_capacity || 0)
      const total = Number(m.total_capacity || 0)
      return total > 0 ? { used, total } : null
    } catch {
      return null
    }
  }

  async transfer(account, link, passcode, targetPath = '/') {
    this.needCookie(account)
    const pwdId = link.key
    if (!pwdId) this.fail('夸克分享链接格式不正确')

    const tokenRes = await this.call(account, 'POST',
      'https://drive-pc.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc',
      { pwd_id: pwdId, passcode: passcode || '', stoken: '' })
    const stoken = tokenRes.data?.stoken
    if (!stoken) this.fail('夸克分享链接校验失败,请检查提取码')

    const detail = await this.call(account, 'GET',
      `https://drive-pc.quark.cn/1/clouddrive/share/sharepage/detail?pr=ucpro&fr=pc&pwd_id=${pwdId}&stoken=${encodeURIComponent(stoken)}&pdir_fid=0&_page=1&_size=100`)
    const items = (detail.data?.list || []).filter((x) => x.dir || x.file)
    if (!items.length) this.fail('分享里没有可转存的内容')

    const sourceName = safeName(
      detail.data?.share?.title ||
      detail.data?.title ||
      (items.length === 1 ? items[0].file_name : '') ||
      link.key,
      link.key
    )
    const job = await this.transferFolder(account, targetPath, sourceName)
    const jobPath = job.path
    const targetFid = job.fid
    const saved = await this.call(account, 'POST', this.saveEndpoint(), {
      fid_list: items.map((x) => x.share_fid || x.fid),
      fid_token_list: items.map((x) => x.share_fid_token || ''),
      to_pdir_fid: targetFid,
      pwd_id: pwdId,
      stoken,
      pdir_fid: '0',
      scene: 'link'
    })
    if (!saved.data?.task_id) this.fail('夸克转存任务创建失败')

    const task = await this.waitTask(account, saved.data.task_id, '转存')
    const savedFids = (task.save_as?.save_as_top_fids || task.save_as_top_fids || []).map(String)
    if (!savedFids.length) this.fail('夸克转存完成,但没有返回新文件 ID')

    const targetFiles = await this.listByFid(account, targetFid, jobPath)
    const savedPaths = targetFiles
      .filter((item) => savedFids.includes(String(item.fid)))
      .map((item) => item.path)

    return {
      sourceName,
      savedFids,
      savedPaths: savedPaths.length ? savedPaths : [jobPath]
    }
  }

  async share(account, paths, opts = {}) {
    this.needCookie(account)
    const fids = Array.isArray(opts.fids) && opts.fids.length
      ? opts.fids.map(String)
      : []
    if (!fids.length) {
      for (const path of paths) fids.push(await this.itemId(account, path))
    }
    if (!fids.length) this.fail('请选择要分享的内容')

    const requestedDays = Number(opts.expires)
    const days = opts.unlimited || requestedDays === 0
      ? 0
      : Number.isFinite(requestedDays) && requestedDays > 0
        ? Math.trunc(requestedDays)
        : 7
    const payload = {
      fid_list: fids,
      title: opts.title || String(paths[0]).split('/').pop() || '云梭分享',
      url_type: 1,
      expired_type: days === 0 ? 1 : 2,
      passcode: ''
    }
    if (days > 0) payload.expired_at = Date.now() + days * 86400000
    const taskCreated = await this.call(account, 'POST', this.shareEndpoint(), payload)
    if (!taskCreated.data?.task_id) this.fail('夸克分享任务创建失败')

    const task = await this.waitTask(account, taskCreated.data.task_id, '创建分享')
    const shareId = task.share_id
    if (!shareId) this.fail('夸克分享完成,但没有返回分享 ID')

    const data = await this.call(account, 'POST',
      'https://drive-pc.quark.cn/1/clouddrive/share/password?pr=ucpro&fr=pc&uc_param_str=',
      { share_id: shareId })
    const url = data.data?.share_url || data.data?.url || ''
    if (!url) this.fail('夸克没有返回分享链接')

    return {
      shareId,
      url,
      passcode: '',
      expires: days
    }
  }

  async waitTask(account, taskId, action) {
    for (let attempt = 0; attempt < 90; attempt++) {
      const data = await this.call(account, 'GET', this.taskEndpoint({
        task_id: taskId,
        retry_index: attempt
      }))
      const task = data.data || {}
      const status = Number(task.status)
      if (status === 2) return task
      if (status === 3) {
        this.fail(`夸克${action}失败: ${task.message || task.task_msg || '任务执行失败'}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    this.fail(`夸克${action}超时,请稍后到网盘确认`)
  }

  async qrStart() {
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      v: '1.2',
      request_id: requestId()
    })
    const res = await fetch(`https://uop.quark.cn/cas/ajax/getTokenForQrcodeLogin?${query}`, {
      headers: { 'User-Agent': UA, Referer: 'https://pan.quark.cn/' }
    }).then((r) => r.json()).catch(() => ({}))
    const token = res.data?.members?.token
    if (Number(res.status) !== 2000000 || !token) {
      this.fail('获取夸克二维码失败: ' + (res.message || res.status || '接口无响应'))
    }
    const qrQuery = new URLSearchParams({
      token,
      client_id: CLIENT_ID,
      ssb: 'weblogin',
      uc_param_str: '',
      uc_biz_str: 'S:custom|OPT:SAREA@0|OPT:IMMERSIVE@1|OPT:BACK_BTN_STYLE@0'
    })
    const url = `https://su.quark.cn/4_eMHBJ?${qrQuery}`
    return {
      token,
      qrText: url,
      qrImage: await QRCode.toDataURL(url, { width: 260, margin: 1, color: { dark: '#101822', light: '#ffffff' } })
    }
  }

  async qrPoll(token) {
    if (!token) this.fail('夸克扫码 token 为空')
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      v: '1.2',
      token,
      request_id: requestId()
    })
    const res = await fetch(`https://uop.quark.cn/cas/ajax/getServiceTicketByQrcodeToken?${query}`, {
      headers: { 'User-Agent': UA, Referer: 'https://pan.quark.cn/' }
    }).then((r) => r.json()).catch(() => ({}))
    const status = Number(res.status ?? res.code)
    const ticket = res.data?.members?.service_ticket
    if (ticket) {
      const cookie = await this.exchangeTicket(ticket)
      return { status: 'confirmed', cookie, label: await this.accountLabel(cookie) }
    }
    if (status === 2000000 || QR_WAITING_CODES.has(status)) return { status: 'pending' }
    if (QR_EXPIRED_CODES.has(status)) return { status: 'expired' }
    console.warn(`[quark-qr] unexpected poll status=${status || 'unknown'} message=${res.message || ''}`)
    return { status: 'pending' }
  }

  async exchangeTicket(ticket) {
    const jar = new Map()
    let url = `https://pan.quark.cn/account/info?${new URLSearchParams({ st: ticket, lw: 'scan' })}`
    for (let redirect = 0; redirect < 6; redirect++) {
      const res = await fetch(url, {
        redirect: 'manual',
        headers: {
          'User-Agent': UA,
          Referer: 'https://pan.quark.cn/',
          ...(jar.size ? { Cookie: cookieHeader(jar) } : {})
        }
      })
      mergeCookies(jar, res.headers)
      const location = res.headers.get('location')
      if (!location) break
      url = new URL(location, url).toString()
    }

    let cookie = cookieHeader(jar)
    if (!hasSessionCookie(cookie)) {
      const flush = await fetch('https://drive-pc.quark.cn/1/clouddrive/auth/pc/flush?pr=ucpro&fr=pc&uc_param_str=', {
        redirect: 'manual',
        headers: {
          'User-Agent': UA,
          Referer: 'https://pan.quark.cn/',
          ...(cookie ? { Cookie: cookie } : {})
        }
      }).catch(() => null)
      if (flush) mergeCookies(jar, flush.headers)
      cookie = cookieHeader(jar)
    }

    if (!hasSessionCookie(cookie)) {
      this.fail('夸克登录已确认，但未取得有效会话 Cookie，请刷新二维码重试')
    }
    return cookie
  }

  async accountLabel(cookie) {
    try {
      const res = await fetch('https://pan.quark.cn/account/info?fr=pc&platform=pc', {
        headers: { Cookie: cookie, 'User-Agent': UA, Referer: 'https://pan.quark.cn/' }
      })
      const data = await res.json()
      return String(data.data?.nickname || data.data?.username || '夸克账号').slice(0, 60)
    } catch {
      return '夸克账号'
    }
  }
}
