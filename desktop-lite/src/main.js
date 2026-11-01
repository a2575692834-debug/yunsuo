const { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

const WINDOW_BACKGROUND = '#f3ede2'
const TOKEN_SYNC_MS = 2500
const LOCAL_MONITOR_TICK_MS = 15000
const TEST_MODE = process.env.YUNSUO_TEST_MODE === '1'

if (process.env.YUNSUO_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.YUNSUO_USER_DATA))
}

let setupWindow = null
let appWindow = null
let tokenTimer = null
let localMonitorTimer = null
let localMonitorRunning = false
let tokenInjectionAttempted = false

function normalizeBaseUrl(value) {
  let raw = String(value || '').trim()
  if (!raw) throw new Error('请输入登录地址')
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw
  const parsed = new URL(raw)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('登录地址仅支持 HTTP 或 HTTPS')
  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/i, '')
  return parsed.toString().replace(/\/+$/, '')
}

function configPath() {
  return path.join(app.getPath('userData'), 'connection.json')
}

async function readConfig() {
  try {
    const raw = JSON.parse(await fs.readFile(configPath(), 'utf8'))
    let token = ''
    if (raw.token && safeStorage.isEncryptionAvailable()) {
      token = safeStorage.decryptString(Buffer.from(raw.token, 'base64'))
    }
    return {
      baseUrl: raw.baseUrl ? normalizeBaseUrl(raw.baseUrl) : '',
      username: String(raw.username || ''),
      token
    }
  } catch {
    return { baseUrl: '', username: '', token: '' }
  }
}

async function writeConfig({ baseUrl, username = '', token = '' }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const payload = {
    baseUrl: normalizedBaseUrl,
    username: String(username || ''),
    token: ''
  }
  if (token) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统不支持安全存储，登录 Token 无法加密保存')
    }
    payload.token = safeStorage.encryptString(token).toString('base64')
  }
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify(payload), 'utf8')
  return {
    baseUrl: normalizedBaseUrl,
    username: payload.username,
    hasToken: !!token
  }
}

async function publicConfig() {
  const config = await readConfig()
  return {
    baseUrl: config.baseUrl,
    username: config.username,
    hasToken: !!config.token,
    appRunning: !!appWindow && !appWindow.isDestroyed()
  }
}

async function requestJson(baseUrl, pathname, {
  method = 'GET',
  token = '',
  body,
  timeout = 20000
} = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const headers = { Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(baseUrl + pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw Object.assign(new Error(data.error || `请求失败（HTTP ${response.status}）`), {
        status: response.status
      })
    }
    return data
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接服务超时，请检查地址和网络')
    if (/fetch failed/i.test(String(error.message))) {
      throw new Error('无法连接服务，请检查地址、HTTPS 证书和网络')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function checkServer(baseUrl) {
  const data = await requestJson(baseUrl, '/api/health')
  if (data.ok !== true) throw new Error(data.error || '服务健康检查失败')
}

function setSetupMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '云梭',
      submenu: [
        {
          label: '打开完整版',
          click: () => {
            if (appWindow && !appWindow.isDestroyed()) {
              appWindow.show()
              appWindow.focus()
            }
          }
        },
        { label: '登录设置', click: () => openSetupWindow() },
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

function revealWindow(window) {
  if (TEST_MODE) {
    window.setOpacity(0)
    window.showInactive()
    return
  }
  window.show()
}

function setAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '云梭',
      submenu: [
        { label: '登录设置', click: () => openSetupWindow() },
        {
          label: '刷新完整版',
          click: () => {
            if (appWindow && !appWindow.isDestroyed()) appWindow.reload()
          }
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '监控',
      submenu: [
        { label: '本地监控仅在桌面端运行时执行', enabled: false },
        {
          label: '立即执行一次本地巡检',
          click: () => runLocalMonitorTick()
        }
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

function createSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.show()
    setupWindow.focus()
    return setupWindow
  }

  setupWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 860,
    minHeight: 640,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    title: '云梭桌面端 · 登录',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    parent: appWindow && !appWindow.isDestroyed() ? appWindow : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  setSetupMenu()
  setupWindow.setMenuBarVisibility(false)
  setupWindow.loadFile(path.join(__dirname, 'index.html'))
  setupWindow.once('ready-to-show', () => revealWindow(setupWindow))
  setupWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  setupWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault()
  })
  setupWindow.on('closed', () => {
    setupWindow = null
    if (!appWindow && process.platform !== 'darwin') app.quit()
  })
  return setupWindow
}

function openSetupWindow() {
  createSetupWindow()
}

function stopTokenSync() {
  if (tokenTimer) clearInterval(tokenTimer)
  tokenTimer = null
}

async function injectSavedToken(baseUrl) {
  const config = await readConfig()
  if (config.baseUrl !== baseUrl || !config.token || !appWindow) return
  try {
    const hasToken = await appWindow.webContents.executeJavaScript(
      "localStorage.getItem('ys_token') || ''",
      true
    )
    if (hasToken) {
      tokenInjectionAttempted = true
    } else if (!tokenInjectionAttempted) {
      tokenInjectionAttempted = true
      await appWindow.webContents.executeJavaScript(
        `localStorage.setItem('ys_token', ${JSON.stringify(config.token)})`,
        true
      )
      appWindow.reload()
    }
  } catch {
    // The page may still be navigating; the next load will retry the sync.
  }
}

function startTokenSync(baseUrl) {
  stopTokenSync()
  tokenTimer = setInterval(async () => {
    if (!appWindow || appWindow.isDestroyed()) return
    try {
      const state = await appWindow.webContents.executeJavaScript(
        "({ token: localStorage.getItem('ys_token') || '', url: location.href })",
        true
      )
      const config = await readConfig()
      if (config.baseUrl !== baseUrl) return
      if (state.token) {
        if (state.token !== config.token) {
          await writeConfig({ baseUrl, username: config.username, token: state.token })
        }
      } else if (tokenInjectionAttempted && config.token) {
        await writeConfig({ baseUrl, username: config.username, token: '' })
      }
    } catch {
      // Ignore transitions between login and application pages.
    }
  }, TOKEN_SYNC_MS)
  tokenTimer.unref?.()
}

function stopLocalMonitorLoop() {
  if (localMonitorTimer) clearInterval(localMonitorTimer)
  localMonitorTimer = null
  localMonitorRunning = false
}

async function runLocalMonitorTick() {
  if (localMonitorRunning) return
  if (!appWindow || appWindow.isDestroyed()) return
  localMonitorRunning = true
  try {
    const config = await readConfig()
    if (!config.baseUrl || !config.token) return
    const monitors = await requestJson(config.baseUrl, '/api/monitors', {
      token: config.token
    })
    if (!Array.isArray(monitors)) return
    const now = Date.now()
    const due = monitors
      .filter((monitor) => (
        monitor.enabled &&
        monitor.runMode === 'local' &&
        monitor.nextCheckAt &&
        monitor.nextCheckAt <= now &&
        !['checking', 'syncing'].includes(monitor.status) &&
        (!monitor.lockedUntil || monitor.lockedUntil < now)
      ))
      .slice(0, 3)
    for (const monitor of due) {
      await requestJson(config.baseUrl, `/api/monitors/${encodeURIComponent(monitor.id)}/local-run`, {
        method: 'POST',
        token: config.token,
        body: {},
        timeout: 90000
      }).catch(() => {})
    }
  } catch (error) {
    if (error.status === 401) return
  } finally {
    localMonitorRunning = false
  }
}

function startLocalMonitorLoop() {
  stopLocalMonitorLoop()
  setTimeout(() => runLocalMonitorTick(), 2500).unref?.()
  localMonitorTimer = setInterval(() => runLocalMonitorTick(), LOCAL_MONITOR_TICK_MS)
  localMonitorTimer.unref?.()
}

function createAppWindow(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.destroy()
  }
  stopTokenSync()
  tokenInjectionAttempted = false

  appWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    title: '云梭 · 网盘转存',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:yunsuo-desktop'
    }
  })

  setAppMenu()
  appWindow.once('ready-to-show', () => revealWindow(appWindow))
  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  appWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== new URL(normalizedBaseUrl).origin) {
        event.preventDefault()
        if (/^https?:\/\//i.test(url)) shell.openExternal(url)
      }
    } catch {
      event.preventDefault()
    }
  })
  appWindow.webContents.on('did-finish-load', async () => {
    await injectSavedToken(normalizedBaseUrl)
    startTokenSync(normalizedBaseUrl)
  })
  appWindow.on('closed', () => {
    stopTokenSync()
    stopLocalMonitorLoop()
    appWindow = null
    if (!setupWindow && process.platform !== 'darwin') app.quit()
  })

  startLocalMonitorLoop()
  appWindow.loadURL(normalizedBaseUrl).catch(() => {
    createSetupWindow()
    if (appWindow && !appWindow.isDestroyed()) appWindow.destroy()
  })
}

async function connect(payload = {}) {
  const baseUrl = normalizeBaseUrl(payload.baseUrl)
  if (payload.verifyServer === true) await checkServer(baseUrl)
  const current = await readConfig()
  const token = current.baseUrl === baseUrl ? current.token : ''
  const username = current.baseUrl === baseUrl ? current.username : ''
  await writeConfig({ baseUrl, username, token })
  createAppWindow(baseUrl)
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close()
  return { ok: true, baseUrl, hasToken: !!token }
}

async function login(payload = {}) {
  const baseUrl = normalizeBaseUrl(payload.baseUrl)
  const username = String(payload.username || '').trim()
  const password = String(payload.password || '')
  if (!username) throw new Error('请输入账号')
  if (!password) throw new Error('请输入密码')
  if (payload.verifyServer === true) await checkServer(baseUrl)
  const data = await requestJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username, password }
  })
  if (!data.token || !data.user) throw new Error('服务没有返回有效登录信息')
  await writeConfig({
    baseUrl,
    username: data.user.username || username,
    token: data.token
  })
  createAppWindow(baseUrl)
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close()
  return {
    ok: true,
    baseUrl,
    user: data.user
  }
}

ipcMain.handle('desktop:connect', (_event, payload) => connect(payload))
ipcMain.handle('desktop:login', (_event, payload) => login(payload))
ipcMain.handle('desktop:load', publicConfig)
ipcMain.handle('desktop:resume', async () => {
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.show()
    appWindow.focus()
  } else {
    const config = await readConfig()
    if (!config.baseUrl) throw new Error('尚未保存登录地址')
    createAppWindow(config.baseUrl)
  }
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close()
  return { ok: true }
})
ipcMain.handle('desktop:clear-token', async () => {
  const config = await readConfig()
  if (!config.baseUrl) return { ok: true }
  await writeConfig({ baseUrl: config.baseUrl, username: config.username, token: '' })
  if (appWindow && !appWindow.isDestroyed()) {
    await appWindow.webContents.executeJavaScript("localStorage.removeItem('ys_token')", true).catch(() => {})
  }
  return { ok: true }
})
ipcMain.handle('shell:open', (_event, url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('链接格式不正确')
  return shell.openExternal(String(url))
})

app.whenReady().then(async () => {
  app.setAppUserModelId('com.yunsuo.desktop')
  const config = await readConfig()
  if (config.baseUrl) createAppWindow(config.baseUrl)
  else createSetupWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createSetupWindow()
  })
})

app.on('before-quit', () => {
  stopTokenSync()
  stopLocalMonitorLoop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
