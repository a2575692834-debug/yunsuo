const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  safeStorage,
  shell
} = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')

const PROVIDER_IDS = ['baidu', 'quark', 'xunlei']
const MAX_HISTORY = 600
const MAX_SHARES = 1200
const TEST_MODE = process.env.YUNSUO_LOCAL_TEST === '1'

if (process.env.YUNSUO_LOCAL_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.YUNSUO_LOCAL_USER_DATA))
}

let mainWindow = null
let state = null
let saveChain = Promise.resolve()
let transferRunning = false
let monitorRunning = false
let monitorTimer = null
let providerModulePromise = null
let parseModulePromise = null

function dataFilePath() {
  return path.join(app.getPath('userData'), 'yunsuo-local.json')
}

function nowId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function emptyState() {
  return {
    version: 1,
    createdAt: Date.now(),
    settings: {
      theme: 'paper',
      defaultPasscode: '8888',
      defaultExpiry: 0,
      defaultTargetMode: 'today',
      customTargetPath: ''
    },
    accounts: [],
    history: [],
    shares: [],
    monitors: []
  }
}

function mergeState(raw) {
  const defaults = emptyState()
  return {
    ...defaults,
    ...(raw && typeof raw === 'object' ? raw : {}),
    settings: { ...defaults.settings, ...(raw?.settings || {}) },
    accounts: Array.isArray(raw?.accounts) ? raw.accounts : [],
    history: Array.isArray(raw?.history) ? raw.history : [],
    shares: Array.isArray(raw?.shares) ? raw.shares : [],
    monitors: Array.isArray(raw?.monitors) ? raw.monitors : []
  }
}

async function loadState() {
  try {
    state = mergeState(JSON.parse(await fs.readFile(dataFilePath(), 'utf8')))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      const backup = `${dataFilePath()}.corrupt-${Date.now()}`
      await fs.rename(dataFilePath(), backup).catch(() => {})
      console.error(`[local] data file backup: ${backup}`)
    }
    state = emptyState()
    await saveState()
  }
}

async function writeNow() {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  const temporary = `${dataFilePath()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8')
  await fs.rename(temporary, dataFilePath())
}

function saveState() {
  saveChain = saveChain.then(writeNow, writeNow)
  return saveChain
}

function protectCookie(cookie) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前 Windows 无法使用安全存储，不能保存网盘 Cookie')
  }
  return `safe:${safeStorage.encryptString(String(cookie)).toString('base64')}`
}

function revealCookie(value) {
  const text = String(value || '')
  if (!text.startsWith('safe:')) return text
  try {
    return safeStorage.decryptString(Buffer.from(text.slice(5), 'base64'))
  } catch {
    throw new Error('网盘登录凭据无法解密，请删除该账号后重新登录')
  }
}

function accountWithCookie(account) {
  return {
    ...account,
    cookie: revealCookie(account.cookie)
  }
}

function accountForUi(account) {
  return {
    id: account.id,
    provider: account.provider,
    label: account.label,
    hasCookie: Boolean(account.cookie),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  }
}

function getAccount(id) {
  return state.accounts.find((account) => account.id === id) || null
}

async function loadProviderApi() {
  if (!providerModulePromise) {
    const file = path.join(__dirname, '..', 'vendor', 'providers', 'index.js')
    providerModulePromise = import(pathToFileURL(file).href)
  }
  return providerModulePromise
}

async function loadParseApi() {
  if (!parseModulePromise) {
    const file = path.join(__dirname, '..', 'vendor', 'utils', 'parse.js')
    parseModulePromise = import(pathToFileURL(file).href)
  }
  return parseModulePromise
}

async function providerFor(providerId) {
  if (!PROVIDER_IDS.includes(providerId)) throw new Error('不支持的网盘类型')
  const api = await loadProviderApi()
  return api.getProvider(providerId)
}

async function providerList() {
  const api = await loadProviderApi()
  return api.listProviders().filter((item) => PROVIDER_IDS.includes(item.id))
}

async function inlineQrImage(value) {
  const image = String(value || '')
  if (!/^https?:\/\//i.test(image)) return image
  try {
    const response = await fetch(image, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
        Referer: 'https://pan.baidu.com/'
      }
    })
    if (!response.ok) return image
    const type = response.headers.get('content-type') || 'image/png'
    const data = Buffer.from(await response.arrayBuffer())
    return `data:${type};base64,${data.toString('base64')}`
  } catch {
    return image
  }
}

function emit(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function errorMessage(error) {
  return String(error?.message || error || '操作失败')
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
}

function todayFolder() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `/${year}-${month}-${day}`
}

function normalizeCloudPath(value, fallbackToToday = true) {
  let target = String(value || '').trim().replace(/\\/g, '/')
  if (!target && fallbackToToday) target = todayFolder()
  if (!target) return '/'
  if (!target.startsWith('/')) target = `/${target}`
  target = target.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
  if (/[<>:"|?*\u0000-\u001f]/.test(target)) {
    throw new Error('转存目录包含不支持的字符')
  }
  if (target.length > 240) throw new Error('转存目录过长')
  return target
}

function normalizePasscode(providerId, value) {
  if (providerId === 'quark') return ''
  const passcode = String(value ?? '').trim().toUpperCase()
  if (!passcode) return ''
  if (!/^[A-Z0-9]{4}$/.test(passcode)) {
    throw new Error('分享提取码需为 4 位字母或数字')
  }
  return passcode
}

async function upsertAccount({ provider: providerId, label = '', cookie = '' }) {
  const provider = await providerFor(providerId)
  let normalizedCookie = String(cookie || '').trim()
  if (!normalizedCookie) throw new Error('请填写网盘 Cookie，或使用扫码登录')

  if (providerId === 'baidu' && typeof provider.refreshSession === 'function') {
    try {
      const refreshed = await provider.refreshSession({ cookie: normalizedCookie })
      if (refreshed?.cookie) normalizedCookie = refreshed.cookie
    } catch {
      // A pasted web Cookie can still be valid for operations even if preflight fails.
    }
  }

  const same = state.accounts.find((item) => {
    try {
      return item.provider === providerId && revealCookie(item.cookie) === normalizedCookie
    } catch {
      return false
    }
  })
  const timestamp = Date.now()
  if (same) {
    same.cookie = protectCookie(normalizedCookie)
    same.label = String(label || same.label || provider.name).trim().slice(0, 80)
    same.updatedAt = timestamp
    await saveState()
    return same
  }

  const count = state.accounts.filter((item) => item.provider === providerId).length + 1
  const account = {
    id: nowId('acc'),
    provider: providerId,
    label: String(label || `${provider.name} ${count}`).trim().slice(0, 80),
    cookie: protectCookie(normalizedCookie),
    createdAt: timestamp,
    updatedAt: timestamp
  }
  state.accounts.push(account)
  await saveState()
  return account
}

async function accountUsage(account) {
  try {
    const provider = await providerFor(account.provider)
    return await provider.usage(accountWithCookie(account))
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

async function createShare(provider, account, saved, options) {
  const paths = saved.savedPaths?.length ? saved.savedPaths : ['/']
  return provider.share(account, paths, {
    unlimited: options.expires === 0,
    expires: options.expires,
    passcode: options.passcode,
    title: saved.sourceName,
    fids: saved.savedFids || []
  })
}

async function runOneTransfer({
  accountId,
  link,
  targetPath,
  autoShare,
  expires,
  passcode,
  batchId,
  source = 'manual'
}) {
  const startedAt = Date.now()
  const account = getAccount(accountId)
  if (!account) throw new Error(`还没有添加${link.providerName || link.provider}账号`)
  if (account.provider !== link.provider) throw new Error('账号与分享链接的网盘类型不一致')

  const activeAccount = accountWithCookie(account)
  const provider = await providerFor(account.provider)
  const record = {
    id: nowId('history'),
    batchId,
    accountId,
    provider: account.provider,
    providerName: provider.name,
    title: link.key,
    sourceUrl: link.url,
    savedPath: '',
    shareUrl: '',
    sharePasscode: '',
    expires,
    status: 'running',
    error: '',
    source,
    createdAt: startedAt
  }

  try {
    const saved = await provider.transfer(
      activeAccount,
      { ...link, syncMode: source === 'monitor' },
      link.passcode || '',
      targetPath
    )
    record.title = String(saved.sourceName || link.key || '转存内容').slice(0, 200)
    record.savedPath = saved.savedPaths?.[0] || targetPath
    record.status = 'success'

    if (autoShare) {
      try {
        const shared = await createShare(provider, activeAccount, saved, { expires, passcode })
        record.shareUrl = String(shared.url || '')
        record.sharePasscode = String(shared.passcode || '')
        record.expires = shared.expires ?? expires
        const shareRecord = {
          id: nowId('share'),
          historyId: record.id,
          accountId,
          provider: account.provider,
          providerName: provider.name,
          title: record.title,
          url: record.shareUrl,
          passcode: record.sharePasscode,
          expires: record.expires,
          createdAt: Date.now()
        }
        state.shares.unshift(shareRecord)
        state.shares = state.shares.slice(0, MAX_SHARES)
      } catch (error) {
        record.status = 'partial'
        record.error = `转存成功，分享失败：${errorMessage(error)}`
      }
    }
    return record
  } catch (error) {
    record.status = 'error'
    record.error = errorMessage(error)
    return record
  } finally {
    record.finishedAt = Date.now()
    state.history.unshift(record)
    state.history = state.history.slice(0, MAX_HISTORY)
    await saveState()
  }
}

function safeShareText(results) {
  return results
    .filter((item) => item.status === 'success' || item.status === 'partial')
    .map((item) => {
      const lines = [item.title, `${item.providerName} ${item.shareUrl || ''}`.trim()]
      if (item.sharePasscode) lines.push(`提取码 ${item.sharePasscode}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

async function runMonitor(monitor, { manual = false } = {}) {
  const account = getAccount(monitor.accountId)
  if (!account) {
    monitor.status = 'error'
    monitor.lastError = '监控绑定的网盘账号已被删除'
    monitor.nextCheckAt = Date.now() + 30 * 60000
    await saveState()
    return { ok: false, error: monitor.lastError }
  }

  try {
    const parseApi = await loadParseApi()
    const provider = await providerFor(account.provider)
    const link = parseApi.parseOne(monitor.url)
    if (!link) throw new Error('监控链接无法解析')
    link.passcode = monitor.passcode || ''
    link.provider = account.provider
    link.providerName = provider.name

    monitor.status = 'checking'
    monitor.lastError = ''
    await saveState()
    emit('local:monitor-changed', monitor)

    const inspected = await provider.inspectShare(accountWithCookie(account), link, link.passcode)
    const changed = manual || !monitor.lastSignature || inspected.signature !== monitor.lastSignature
    monitor.lastCheckedAt = Date.now()
    monitor.lastTitle = inspected.title || monitor.lastTitle || ''

    if (changed) {
      monitor.status = 'syncing'
      emit('local:monitor-changed', monitor)
      const result = await runOneTransfer({
        accountId: monitor.accountId,
        link,
        targetPath: monitor.targetPath,
        autoShare: monitor.autoShare,
        expires: monitor.expires,
        passcode: monitor.sharePasscode,
        batchId: nowId('monitor'),
        source: 'monitor'
      })
      monitor.lastHistoryId = result.id
      monitor.lastShareUrl = result.shareUrl || ''
      if (result.status === 'error') throw new Error(result.error)
      monitor.lastSignature = inspected.signature
      monitor.lastChangeAt = Date.now()
      monitor.status = result.status === 'partial' ? 'warning' : 'idle'
      monitor.lastError = result.error || ''
    } else {
      monitor.status = 'idle'
    }

    monitor.failureCount = 0
    monitor.nextCheckAt = Date.now() + monitor.intervalMinutes * 60000
    monitor.updatedAt = Date.now()
    await saveState()
    emit('local:monitor-changed', monitor)
    return { ok: true, changed, monitor }
  } catch (error) {
    monitor.status = 'error'
    monitor.lastError = errorMessage(error)
    monitor.failureCount = Number(monitor.failureCount || 0) + 1
    monitor.lastCheckedAt = Date.now()
    monitor.nextCheckAt = Date.now() + Math.min(
      360,
      Math.max(5, Number(monitor.intervalMinutes || 30)) * 2 ** Math.min(monitor.failureCount, 4)
    ) * 60000
    monitor.updatedAt = Date.now()
    await saveState()
    emit('local:monitor-changed', monitor)
    return { ok: false, error: monitor.lastError, monitor }
  }
}

async function runDueMonitors() {
  if (monitorRunning) return
  monitorRunning = true
  try {
    const due = state.monitors
      .filter((monitor) => monitor.enabled && monitor.nextCheckAt && monitor.nextCheckAt <= Date.now())
      .sort((a, b) => a.nextCheckAt - b.nextCheckAt)
      .slice(0, 2)
    for (const monitor of due) await runMonitor(monitor)
  } finally {
    monitorRunning = false
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: '云梭本地版',
    backgroundColor: '#f2ede3',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  mainWindow.once('ready-to-show', () => {
    if (TEST_MODE) {
      mainWindow.setOpacity(0)
      mainWindow.showInactive()
    } else {
      mainWindow.show()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '云梭本地版',
      submenu: [
        {
          label: '打开本地数据目录',
          click: () => shell.openPath(app.getPath('userData'))
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'togglefullscreen', label: '全屏' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' }
      ]
    }
  ]))
}

function registerIpc() {
  ipcMain.handle('local:info', async () => ({
    name: '云梭本地版',
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    dataPath: app.getPath('userData'),
    encryption: safeStorage.isEncryptionAvailable(),
    online: false
  }))
  ipcMain.handle('local:providers', () => providerList())
  ipcMain.handle('local:parse', async (_event, text) => {
    const parseApi = await loadParseApi()
    return parseApi.parseMany(String(text || ''))
  })

  ipcMain.handle('local:accounts:list', () => state.accounts.map(accountForUi))
  ipcMain.handle('local:accounts:add', async (_event, payload) => {
    const account = await upsertAccount(payload || {})
    return accountForUi(account)
  })
  ipcMain.handle('local:accounts:update', async (_event, payload) => {
    const account = getAccount(String(payload?.id || ''))
    if (!account) throw new Error('网盘账号不存在')
    let cookie = payload?.cookie
    if (cookie !== undefined) {
      const provider = await providerFor(account.provider)
      if (account.provider === 'baidu' && typeof provider.refreshSession === 'function') {
        try {
          const refreshed = await provider.refreshSession({ cookie: String(cookie || '').trim() })
          cookie = refreshed?.cookie || cookie
        } catch {
          // Keep the user-supplied Cookie and let the next operation surface API errors.
        }
      }
      account.cookie = protectCookie(String(cookie || '').trim())
    }
    if (payload?.label !== undefined) account.label = String(payload.label).trim().slice(0, 80)
    account.updatedAt = Date.now()
    await saveState()
    return accountForUi(account)
  })
  ipcMain.handle('local:accounts:delete', async (_event, id) => {
    const account = getAccount(String(id || ''))
    if (!account) return { ok: true }
    state.accounts = state.accounts.filter((item) => item.id !== account.id)
    state.monitors = state.monitors.filter((item) => item.accountId !== account.id)
    await saveState()
    return { ok: true }
  })
  ipcMain.handle('local:accounts:usage', async (_event, id) => {
    const account = getAccount(String(id || ''))
    if (!account) throw new Error('网盘账号不存在')
    return accountUsage(account)
  })

  ipcMain.handle('local:qr:start', async (_event, providerId) => {
    const provider = await providerFor(String(providerId || ''))
    const session = await provider.qrStart()
    return {
      ...session,
      qrImage: await inlineQrImage(session.qrImage),
      provider: provider.id,
      providerName: provider.name
    }
  })
  ipcMain.handle('local:qr:poll', async (_event, payload) => {
    const provider = await providerFor(String(payload?.provider || ''))
    const result = await provider.qrPoll(String(payload?.token || ''))
    if (result.status === 'confirmed' && result.cookie) {
      const account = await upsertAccount({
        provider: provider.id,
        label: result.label || provider.name,
        cookie: result.cookie
      })
      return { ...result, cookie: undefined, account: accountForUi(account) }
    }
    return result
  })

  ipcMain.handle('local:transfer:run', async (_event, payload) => {
    if (transferRunning) throw new Error('已有一批转存任务正在执行，请稍候')
    transferRunning = true
    try {
      const parseApi = await loadParseApi()
      const text = String(payload?.text || '')
      const customPasscodes = payload?.passcodes && typeof payload.passcodes === 'object'
        ? payload.passcodes
        : {}
      const links = parseApi.parseMany(text).map((link) => ({
        ...link,
        passcode: String(customPasscodes[link.url] ?? link.passcode ?? '').trim()
      }))
      if (!links.length) throw new Error('没有识别到百度 / 夸克 / 迅雷分享链接')

      const targetPath = normalizeCloudPath(
        payload?.targetPath || (state.settings.defaultTargetMode === 'custom'
          ? state.settings.customTargetPath
          : todayFolder())
      )
      const autoShare = payload?.autoShare !== false
      const expires = Math.max(0, Number(payload?.expires || 0))
      const requestedPasscode = payload?.passcode ?? state.settings.defaultPasscode
      const batchId = nowId('batch')
      const results = []

      for (let index = 0; index < links.length; index++) {
        const link = links[index]
        const account = state.accounts.find((item) => item.provider === link.provider)
        const progress = {
          batchId,
          stage: 'processing',
          index,
          total: links.length,
          percent: Math.round((index / links.length) * 100),
          provider: link.provider,
          providerName: link.providerName,
          title: link.key
        }
        emit('local:transfer-progress', progress)
        if (!account) {
          results.push({
            id: nowId('skipped'),
            provider: link.provider,
            providerName: link.providerName,
            title: link.key,
            sourceUrl: link.url,
            status: 'skipped',
            error: `还没有添加${link.providerName}账号`
          })
          continue
        }

        const passcode = normalizePasscode(link.provider, requestedPasscode)
        const result = await runOneTransfer({
          accountId: account.id,
          link,
          targetPath,
          autoShare,
          expires,
          passcode,
          batchId,
          source: 'manual'
        })
        results.push(result)
        emit('local:transfer-progress', {
          ...progress,
          stage: 'item-done',
          percent: Math.round(((index + 1) / links.length) * 100),
          result
        })
      }

      const summary = {
        batchId,
        targetPath,
        results,
        shareText: safeShareText(results),
        progress: 100
      }
      emit('local:transfer-progress', { batchId, stage: 'complete', percent: 100, summary })
      return summary
    } finally {
      transferRunning = false
    }
  })

  ipcMain.handle('local:history:list', () => state.history.slice(0, 300))
  ipcMain.handle('local:history:clear', async () => {
    state.history = []
    await saveState()
    return { ok: true }
  })
  ipcMain.handle('local:shares:list', () => state.shares.slice(0, 800))
  ipcMain.handle('local:shares:delete', async (_event, id) => {
    state.shares = state.shares.filter((item) => item.id !== id)
    await saveState()
    return { ok: true }
  })

  ipcMain.handle('local:files:list', async (_event, payload) => {
    const account = getAccount(String(payload?.accountId || ''))
    if (!account) throw new Error('请选择网盘账号')
    const provider = await providerFor(account.provider)
    return provider.list(accountWithCookie(account), normalizeCloudPath(payload?.path, false))
  })
  ipcMain.handle('local:files:search', async (_event, payload) => {
    const account = getAccount(String(payload?.accountId || ''))
    if (!account) throw new Error('请选择网盘账号')
    const keyword = String(payload?.keyword || '').trim()
    if (!keyword) return []
    const provider = await providerFor(account.provider)
    return provider.search(accountWithCookie(account), keyword, { limit: 100 })
  })
  ipcMain.handle('local:files:operation', async (_event, payload) => {
    const account = getAccount(String(payload?.accountId || ''))
    if (!account) throw new Error('请选择网盘账号')
    const provider = await providerFor(account.provider)
    const active = accountWithCookie(account)
    const action = String(payload?.action || '')
    const paths = Array.isArray(payload?.paths)
      ? payload.paths.map(String)
      : [String(payload?.path || '')].filter(Boolean)

    if (action === 'rename') {
      const newName = String(payload?.name || '').trim()
      if (!newName) throw new Error('请输入新名称')
      await provider.rename(active, paths[0], newName)
    } else if (action === 'delete') {
      if (!paths.length) throw new Error('请选择要删除的内容')
      await provider.remove(active, paths)
    } else if (action === 'copy' || action === 'move') {
      const destination = normalizeCloudPath(payload?.destination, false)
      if (action === 'copy') await provider.copy(active, paths, destination)
      else await provider.move(active, paths, destination)
    } else if (action === 'mkdir') {
      await provider.mkdir(
        active,
        normalizeCloudPath(payload?.parent, false),
        String(payload?.name || '').trim()
      )
    } else {
      throw new Error('不支持的文件操作')
    }
    return { ok: true }
  })

  ipcMain.handle('local:monitors:list', () => state.monitors)
  ipcMain.handle('local:monitors:add', async (_event, payload) => {
    const parseApi = await loadParseApi()
    const link = parseApi.parseOne(String(payload?.url || ''))
    if (!link) throw new Error('没有识别到支持的网盘分享链接')
    const account = getAccount(String(payload?.accountId || ''))
    if (!account) throw new Error('请选择用于监控的网盘账号')
    if (account.provider !== link.provider) throw new Error('分享链接与所选网盘账号不匹配')
    const intervalMinutes = Math.max(5, Math.min(1440, Number(payload?.intervalMinutes || 30)))
    const monitor = {
      id: nowId('monitor'),
      accountId: account.id,
      provider: account.provider,
      providerName: link.providerName,
      url: link.url,
      passcode: String(payload?.passcode || link.passcode || ''),
      targetPath: normalizeCloudPath(payload?.targetPath || todayFolder()),
      intervalMinutes,
      autoShare: payload?.autoShare !== false,
      expires: Math.max(0, Number(payload?.expires || 0)),
      sharePasscode: normalizePasscode(account.provider, payload?.sharePasscode ?? state.settings.defaultPasscode),
      enabled: true,
      status: 'waiting',
      lastSignature: '',
      lastCheckedAt: null,
      nextCheckAt: Date.now() + 5000,
      lastChangeAt: null,
      lastError: '',
      lastTitle: '',
      lastShareUrl: '',
      lastHistoryId: '',
      failureCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    state.monitors.unshift(monitor)
    await saveState()
    return monitor
  })
  ipcMain.handle('local:monitors:update', async (_event, payload) => {
    const monitor = state.monitors.find((item) => item.id === String(payload?.id || ''))
    if (!monitor) throw new Error('监控不存在')
    if (payload?.enabled !== undefined) {
      monitor.enabled = Boolean(payload.enabled)
      monitor.nextCheckAt = monitor.enabled ? Date.now() + 3000 : null
    }
    if (payload?.intervalMinutes !== undefined) {
      monitor.intervalMinutes = Math.max(5, Math.min(1440, Number(payload.intervalMinutes)))
      if (monitor.enabled) monitor.nextCheckAt = Date.now() + monitor.intervalMinutes * 60000
    }
    if (payload?.autoShare !== undefined) monitor.autoShare = Boolean(payload.autoShare)
    if (payload?.targetPath !== undefined) monitor.targetPath = normalizeCloudPath(payload.targetPath)
    monitor.updatedAt = Date.now()
    await saveState()
    return monitor
  })
  ipcMain.handle('local:monitors:delete', async (_event, id) => {
    state.monitors = state.monitors.filter((item) => item.id !== String(id || ''))
    await saveState()
    return { ok: true }
  })
  ipcMain.handle('local:monitors:run', async (_event, id) => {
    const monitor = state.monitors.find((item) => item.id === String(id || ''))
    if (!monitor) throw new Error('监控不存在')
    return runMonitor(monitor, { manual: true })
  })

  ipcMain.handle('local:settings:get', () => state.settings)
  ipcMain.handle('local:settings:update', async (_event, payload) => {
    const theme = String(payload?.theme || state.settings.theme)
    if (!['paper', 'jade', 'amber', 'night'].includes(theme)) throw new Error('未知主题')
    const passcode = normalizePasscode('baidu', payload?.defaultPasscode ?? state.settings.defaultPasscode)
    const defaultExpiry = Math.max(0, Number(payload?.defaultExpiry ?? state.settings.defaultExpiry))
    const defaultTargetMode = payload?.defaultTargetMode === 'custom' ? 'custom' : 'today'
    const customTargetPath = payload?.customTargetPath === undefined
      ? state.settings.customTargetPath
      : normalizeCloudPath(payload.customTargetPath, false)
    state.settings = {
      ...state.settings,
      theme,
      defaultPasscode: passcode,
      defaultExpiry,
      defaultTargetMode,
      customTargetPath
    }
    await saveState()
    return state.settings
  })

  ipcMain.handle('local:export', async (_event, payload) => {
    const format = ['txt', 'csv', 'md'].includes(payload?.format) ? payload.format : 'txt'
    const extension = format
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出本批转存结果',
      defaultPath: `云梭转存结果-${new Date().toISOString().slice(0, 10)}.${extension}`,
      filters: [{ name: format.toUpperCase(), extensions: [extension] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    await fs.writeFile(result.filePath, String(payload?.content || ''), 'utf8')
    return { ok: true, filePath: result.filePath }
  })
  ipcMain.handle('local:open-external', (_event, url) => {
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('链接格式不正确')
    return shell.openExternal(String(url))
  })
  ipcMain.handle('local:show-data', () => shell.openPath(app.getPath('userData')))
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.yunsuo.local')
  await loadState()
  registerIpc()
  installMenu()
  createWindow()
  monitorTimer = setInterval(() => runDueMonitors().catch(() => {}), 30000)
  monitorTimer.unref?.()
  setTimeout(() => runDueMonitors().catch(() => {}), 4000).unref?.()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  if (monitorTimer) clearInterval(monitorTimer)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
