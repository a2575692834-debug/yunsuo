const api = window.yunsuoDesktop
const $ = (id) => document.getElementById(id)

const el = {
  loginForm: $('loginForm'),
  baseUrlInput: $('baseUrlInput'),
  verifyServerToggle: $('verifyServerToggle'),
  usernameInput: $('usernameInput'),
  passwordInput: $('passwordInput'),
  togglePassword: $('togglePassword'),
  loginButton: $('loginButton'),
  webLoginButton: $('webLoginButton'),
  loginError: $('loginError'),
  connectionBadge: $('connectionBadge'),
  badgeText: $('badgeText'),
  resumePanel: $('resumePanel'),
  savedUserLabel: $('savedUserLabel'),
  resumeButton: $('resumeButton'),
  clearTokenButton: $('clearTokenButton'),
  toastHost: $('toastHost')
}

const state = {
  config: null,
  busy: false
}

const VERIFY_SERVER_KEY = 'ys_verify_server'

try {
  el.verifyServerToggle.checked = localStorage.getItem(VERIFY_SERVER_KEY) === '1'
} catch {
  // The setup page can still start with the safe default when storage is unavailable.
}

function cleanError(error) {
  let message = String(error?.message || error || '操作失败')
  message = message.replace(/^Error invoking remote method '[^']+':\s*/i, '')
  message = message.replace(/^Error:\s*/i, '')
  return message || '操作失败'
}

function toast(message, type = 'success') {
  const node = document.createElement('div')
  node.className = `toast ${type}`
  node.textContent = message
  el.toastHost.appendChild(node)
  const remove = () => {
    node.classList.add('is-leaving')
    setTimeout(() => node.remove(), 220)
  }
  setTimeout(remove, 3200)
  node.addEventListener('click', remove)
}

function showError(message = '') {
  el.loginError.textContent = message
  el.loginError.hidden = !message
}

function setBusy(mode) {
  state.busy = Boolean(mode)
  el.loginButton.disabled = Boolean(mode)
  el.webLoginButton.disabled = Boolean(mode)
  el.resumeButton.disabled = Boolean(mode)
  const label = el.loginButton.querySelector('span')
  const mark = el.loginButton.querySelector('b')
  if (label) {
    label.textContent = mode === 'login'
      ? '正在验证账号…'
      : mode === 'web'
        ? '正在打开站点…'
        : '登录并打开完整版'
  }
  if (mark) mark.textContent = mode ? '…' : '→'
}

function renderConfig(config) {
  state.config = config
  if (config.baseUrl) el.baseUrlInput.value = config.baseUrl
  if (config.username) el.usernameInput.value = config.username

  const hasSession = Boolean(config.baseUrl && config.hasToken)
  el.connectionBadge.hidden = !hasSession
  el.resumePanel.hidden = !hasSession
  el.loginForm.hidden = hasSession
  el.badgeText.textContent = config.appRunning ? '完整版运行中' : '已保存登录'

  if (hasSession) {
    el.savedUserLabel.textContent = config.appRunning
      ? `${config.username || '当前账号'} 已登录，完整版窗口正在运行。`
      : `${config.username || '当前账号'} 已登录，可直接打开完整版。`
  }

  if (hasSession) {
    el.passwordInput.focus()
  } else if (!config.baseUrl) {
    el.baseUrlInput.focus()
  } else {
    el.passwordInput.focus()
  }
}

async function loadConfig() {
  try {
    renderConfig(await api.load())
  } catch (error) {
    showError(cleanError(error))
  }
}

async function submitLogin(event) {
  event.preventDefault()
  if (state.busy) return
  const baseUrl = el.baseUrlInput.value.trim()
  const username = el.usernameInput.value.trim()
  const password = el.passwordInput.value
  showError('')

  if (!baseUrl) return showError('请输入登录地址')
  if (!username) return showError('请输入账号')
  if (!password) return showError('请输入密码')

  setBusy('login')
  try {
    const result = await api.login({
      baseUrl,
      username,
      password,
      verifyServer: el.verifyServerToggle.checked
    })
    el.passwordInput.value = ''
    toast(`欢迎回来，${result.user?.username || username}`)
  } catch (error) {
    showError(cleanError(error))
    el.passwordInput.focus()
    el.passwordInput.select()
  } finally {
    setBusy('')
  }
}

async function openWebLogin() {
  if (state.busy) return
  const baseUrl = el.baseUrlInput.value.trim()
  showError('')
  if (!baseUrl) {
    showError('请先填写登录地址')
    el.baseUrlInput.focus()
    return
  }
  setBusy('web')
  try {
    await api.connect({
      baseUrl,
      verifyServer: el.verifyServerToggle.checked
    })
  } catch (error) {
    showError(cleanError(error))
  } finally {
    setBusy('')
  }
}

async function resume() {
  if (state.busy) return
  setBusy('resume')
  try {
    await api.resume()
  } catch (error) {
    showError(cleanError(error))
  } finally {
    setBusy('')
  }
}

async function clearToken() {
  if (state.busy) return
  showError('')
  setBusy('clear')
  try {
    await api.clearToken()
    await loadConfig()
    el.passwordInput.focus()
    toast('本机登录 Token 已清除', 'success')
  } catch (error) {
    showError(cleanError(error))
  } finally {
    setBusy('')
  }
}

el.loginForm.addEventListener('submit', submitLogin)
el.webLoginButton.addEventListener('click', openWebLogin)
el.resumeButton.addEventListener('click', resume)
el.clearTokenButton.addEventListener('click', clearToken)
el.togglePassword.addEventListener('click', () => {
  const show = el.passwordInput.type === 'password'
  el.passwordInput.type = show ? 'text' : 'password'
  el.togglePassword.textContent = show ? '隐藏' : '显示'
  el.togglePassword.setAttribute('aria-label', show ? '隐藏密码' : '显示密码')
})
el.verifyServerToggle.addEventListener('change', () => {
  try {
    localStorage.setItem(VERIFY_SERVER_KEY, el.verifyServerToggle.checked ? '1' : '0')
  } catch {
    // Remembering this preference is optional.
  }
})

for (const input of [el.baseUrlInput, el.usernameInput, el.passwordInput]) {
  input.addEventListener('input', () => showError(''))
}

loadConfig()
