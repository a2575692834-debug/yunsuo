const api = window.yunsuoLocal
const $ = (id) => document.getElementById(id)

const PROVIDERS = {
  baidu: { name: '百度网盘', short: '百', className: 'provider-baidu' },
  quark: { name: '夸克网盘', short: '夸', className: 'provider-quark' },
  xunlei: { name: '迅雷网盘', short: '迅', className: 'provider-xunlei' }
}

const PAGE_META = {
  dashboard: ['01 / OVERVIEW', '你的网盘工作台', '所有数据都在这台电脑上，不需要账号，也不需要登录服务器。'],
  transfer: ['02 / SMART TRANSFER', '智能转存', '识别混合分享文案，转存到自己的网盘，并生成可复制的分享结果。'],
  accounts: ['03 / ACCOUNTS', '网盘账号', '扫码或粘贴 Cookie，连接你的百度、夸克与迅雷网盘。'],
  files: ['04 / FILES', '我的文件', '浏览、搜索和管理网盘中的文件与目录。'],
  shares: ['05 / SHARE LIBRARY', '分享库', '集中整理本机创建的分享链接，随时复制、导出或打开。'],
  monitors: ['06 / LINK WATCH', '链接监控', '源分享更新后自动转存；监控只在这台电脑上运行。'],
  settings: ['07 / LOCAL SETTINGS', '本地设置', '调整主题、默认转存参数和本地数据位置。']
}

const state = {
  info: null,
  providers: [],
  accounts: [],
  history: [],
  shares: [],
  monitors: [],
  settings: null,
  usages: {},
  parsed: [],
  parseToken: 0,
  result: null,
  file: {
    accountId: '',
    path: '/',
    items: [],
    selectedPath: '',
    searchMode: false
  }
}

let parseTimer = null
let dialogHandler = null
let qrPollTimer = null
let qrPollBusy = false
let qrProvider = ''
let qrToken = ''

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cleanError(error) {
  return String(error?.message || error || '操作失败')
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || '操作失败'
}

function toast(message, type = 'success') {
  const node = document.createElement('div')
  node.className = `toast ${type === 'error' ? 'error' : ''}`
  node.textContent = message
  $('toastHost').appendChild(node)
  const remove = () => {
    node.classList.add('is-leaving')
    setTimeout(() => node.remove(), 220)
  }
  const timer = setTimeout(remove, 3500)
  node.addEventListener('click', () => {
    clearTimeout(timer)
    remove()
  })
}

function formatDate(value, withTime = true) {
  if (!value) return '—'
  const date = new Date(Number(value))
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date)
}

function formatSize(bytes) {
  const value = Number(bytes || 0)
  if (!value) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index++
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`
}

function localDatePath() {
  const date = new Date()
  return `/${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function statusLabel(status) {
  return {
    success: '成功',
    partial: '部分成功',
    error: '失败',
    skipped: '已跳过',
    running: '进行中',
    idle: '正常',
    warning: '有提醒',
    checking: '检查中',
    syncing: '同步中',
    waiting: '等待首次检查'
  }[status] || status || '未知'
}

function providerInfo(provider) {
  return PROVIDERS[provider] || { name: provider || '未知网盘', short: '云', className: '' }
}

function providerIcon(provider) {
  const info = providerInfo(provider)
  return `<span class="account-badge ${info.className}">${info.short}</span>`
}

function statusTag(status) {
  return `<span class="status-tag status-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`
}

function shareTextFor(item) {
  const lines = [
    item.title || '未命名资源',
    `${item.providerName || providerInfo(item.provider).name} ${item.url || item.shareUrl || ''}`.trim()
  ]
  const passcode = item.passcode || item.sharePasscode || ''
  if (passcode) lines.push(`提取码 ${passcode}`)
  return lines.join('\n')
}

function buildBatchText(items = []) {
  return items
    .filter((item) => ['success', 'partial'].includes(item.status) && (item.shareUrl || item.url))
    .map((item) => shareTextFor({
      title: item.title,
      provider: item.provider,
      providerName: item.providerName,
      url: item.shareUrl || item.url,
      passcode: item.sharePasscode || item.passcode
    }))
    .join('\n\n')
}

async function copyText(value) {
  const text = String(value || '')
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = text
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand('copy')
    field.remove()
    return ok
  }
}

function setView(name) {
  if (!PAGE_META[name]) return
  const meta = PAGE_META[name]
  $('pageIndex').textContent = meta[0]
  $('pageTitle').textContent = meta[1]
  $('pageSubtitle').textContent = meta[2]
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.view === name)
  })
  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.panel === name)
  })
  document.querySelector('.workspace').scrollTo({ top: 0, behavior: 'smooth' })
  if (name === 'files') {
    renderFileAccounts()
    if (state.file.accountId && !state.file.items.length) loadFiles(state.file.path)
  }
}

function getDefaultTarget() {
  if (state.settings?.defaultTargetMode === 'custom' && state.settings.customTargetPath) {
    return state.settings.customTargetPath
  }
  return localDatePath()
}

function applyTheme(theme) {
  const value = theme || 'paper'
  $('app').dataset.theme = value
  document.documentElement.dataset.theme = value
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.themeChoice === value)
  })
}

function renderStats() {
  const successCount = state.history.filter((item) => ['success', 'partial'].includes(item.status)).length
  const stats = [
    ['已连接账号', state.accounts.length, '个', '云'],
    ['累计转存', successCount, '次', '↗'],
    ['分享链接', state.shares.length, '条', '链'],
    ['运行中监控', state.monitors.filter((item) => item.enabled).length, '个', '◎']
  ]
  $('statGrid').innerHTML = stats.map(([label, value, unit, icon]) => `
    <article class="stat-card">
      <div class="stat-top"><span>${escapeHtml(label)}</span><i>${escapeHtml(icon)}</i></div>
      <strong>${escapeHtml(value)} <small>${escapeHtml(unit)}</small></strong>
      <small>保存在本机的实时数据</small>
    </article>
  `).join('')
}

function renderRecent() {
  const items = state.history.slice(0, 5)
  $('recentActivity').innerHTML = items.length ? items.map((item) => `
    <div class="activity-item">
      ${providerIcon(item.provider)}
      <div class="activity-copy">
        <strong>${escapeHtml(item.title || '转存任务')}</strong>
        <small>${escapeHtml(item.providerName || providerInfo(item.provider).name)} · ${escapeHtml(formatDate(item.createdAt))}${item.error ? ` · ${escapeHtml(item.error)}` : ''}</small>
      </div>
      ${statusTag(item.status)}
    </div>
  `).join('') : `
    <div class="empty-state"><b>还没有转存记录</b><span>粘贴第一条分享链接开始。</span></div>
  `
}

function renderDashboardAccounts() {
  const items = state.accounts.slice(0, 4)
  $('dashboardAccounts').innerHTML = items.length ? items.map((account) => {
    const usage = state.usages[account.id]
    const percent = usage && !usage.error && Number(usage.total) > 0
      ? Math.min(100, Math.round((Number(usage.used || 0) / Number(usage.total)) * 100))
      : 0
    return `
      <div class="account-mini">
        ${providerIcon(account.provider)}
        <div>
          <strong>${escapeHtml(account.label)}</strong>
          <small>${escapeHtml(providerInfo(account.provider).name)} ${usage?.error ? '· 容量读取失败' : '· Cookie 已加密'}</small>
        </div>
        <span class="usage-ring" style="--percent:${percent}"><span>${percent}%</span></span>
      </div>
    `
  }).join('') : `
    <div class="empty-state"><b>尚未连接网盘</b><span>添加账号后才能转存。</span></div>
  `
}

function renderProviders() {
  const descriptions = {
    baidu: '容量、文件管理、转存与创建分享',
    quark: '扫码登录、转存与无密码分享',
    xunlei: '扫码登录、文件管理与链接同步'
  }
  $('providerConnectGrid').innerHTML = state.providers.map((provider) => {
    const info = providerInfo(provider.id)
    const count = state.accounts.filter((account) => account.provider === provider.id).length
    return `
      <article class="provider-card">
        <div class="provider-card-head">
          <span class="provider-logo account-badge ${info.className}">${info.short}</span>
          <div>
            <h3>${escapeHtml(provider.name)}</h3>
            <p>${escapeHtml(descriptions[provider.id] || '网盘连接与转存')}</p>
          </div>
          <span class="provider-count" style="margin-left:auto">${count}</span>
        </div>
        <div class="provider-card-foot">
          <span>${count ? `已保存 ${count} 个 Cookie` : '等待连接'}</span>
          <div class="provider-actions">
            <button class="soft-button" data-cookie-provider="${provider.id}">Cookie</button>
            <button class="btn btn-primary" style="min-height:31px;padding:0 11px" data-qr-provider="${provider.id}">扫码登录</button>
          </div>
        </div>
      </article>
    `
  }).join('')
}

function renderAccounts() {
  $('accountsList').innerHTML = state.accounts.length ? state.accounts.map((account) => {
    const usage = state.usages[account.id]
    const total = Number(usage?.total || 0)
    const used = Number(usage?.used || 0)
    const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
    const usageText = usage?.error
      ? '容量读取失败'
      : total > 0
        ? `${formatSize(used)} / ${formatSize(total)}`
        : '点击刷新读取容量'
    return `
      <div class="account-row">
        ${providerIcon(account.provider)}
        <div>
          <h4>${escapeHtml(account.label)}</h4>
          <p>${escapeHtml(providerInfo(account.provider).name)} · 更新于 ${escapeHtml(formatDate(account.updatedAt))}</p>
        </div>
        <div class="capacity">
          <div class="capacity-head"><span>${escapeHtml(usageText)}</span><span>${percent}%</span></div>
          <div class="capacity-track"><i style="width:${percent}%"></i></div>
        </div>
        <div class="account-actions">
          <button class="icon-button" title="刷新容量" data-account-action="usage" data-account-id="${account.id}">↻</button>
          <button class="icon-button" title="更新账号" data-account-action="edit" data-account-id="${account.id}">调</button>
          <button class="icon-button" title="删除账号" data-account-action="delete" data-account-id="${account.id}">×</button>
        </div>
      </div>
    `
  }).join('') : `
    <div class="empty-state"><b>还没有网盘账号</b><span>在上方选择扫码登录，或粘贴已有 Cookie。</span></div>
  `
  renderFileAccounts()
  renderMonitorAccounts()
}

function renderAll() {
  renderStats()
  renderRecent()
  renderDashboardAccounts()
  renderProviders()
  renderAccounts()
  renderShares()
  renderMonitors()
  renderSettings()
}

async function refreshUsage(accountId = '', silent = false) {
  const accounts = accountId
    ? state.accounts.filter((account) => account.id === accountId)
    : state.accounts
  if (!accounts.length) {
    if (!silent) toast('请先添加一个网盘账号', 'error')
    return
  }
  await Promise.all(accounts.map(async (account) => {
    try {
      state.usages[account.id] = await api.accountUsage(account.id)
    } catch (error) {
      state.usages[account.id] = { error: cleanError(error) }
    }
  }))
  renderDashboardAccounts()
  renderAccounts()
}

function renderParsedLinks() {
  $('parsedCount').textContent = `${state.parsed.length} 个链接`
  $('parsedLinks').innerHTML = state.parsed.length ? state.parsed.map((link, index) => {
    const info = providerInfo(link.provider)
    return `
      <div class="parsed-link">
        <span class="account-badge ${info.className}">${info.short}</span>
        <div>
          <strong>${escapeHtml(link.providerName)}</strong>
          <small>${escapeHtml(link.url)}</small>
        </div>
        <input class="parsed-code" data-parsed-index="${index}" maxlength="4" spellcheck="false"
          value="${escapeHtml(link.passcode || '')}" placeholder="${link.provider === 'quark' ? '无提取码' : '提取码'}" />
      </div>
    `
  }).join('') : '<div class="empty-inline">等待粘贴分享文案</div>'
}

async function parseSmartText() {
  const text = $('smartText').value.trim()
  const token = ++state.parseToken
  if (!text) {
    state.parsed = []
    renderParsedLinks()
    return
  }
  try {
    const parsed = await api.parse(text)
    if (token !== state.parseToken) return
    state.parsed = parsed
    renderParsedLinks()
  } catch (error) {
    if (token !== state.parseToken) return
    state.parsed = []
    renderParsedLinks()
  }
}

function queueParse() {
  clearTimeout(parseTimer)
  parseTimer = setTimeout(parseSmartText, 260)
}

function updateProgressLog(message, type = '') {
  const node = document.createElement('p')
  node.className = type
  node.textContent = message
  $('progressLogs').appendChild(node)
  $('progressLogs').scrollTop = $('progressLogs').scrollHeight
}

function setProgress(percent, title) {
  const value = Math.max(0, Math.min(100, Number(percent || 0)))
  $('progressBar').style.width = `${value}%`
  $('progressPercent').textContent = `${value}%`
  if (title) $('progressTitle').textContent = title
}

function renderTransferResults(summary) {
  state.result = summary
  const results = summary.results || []
  const success = results.filter((item) => item.status === 'success').length
  const partial = results.filter((item) => item.status === 'partial').length
  const failed = results.filter((item) => item.status === 'error').length
  const skipped = results.filter((item) => item.status === 'skipped').length
  $('transferResultsPanel').hidden = false
  $('resultSummary').textContent = `成功 ${success} · 部分成功 ${partial} · 失败 ${failed} · 跳过 ${skipped} · 目录 ${summary.targetPath}`
  $('transferResults').innerHTML = results.map((item, index) => {
    const info = providerInfo(item.provider)
    const link = item.shareUrl || ''
    return `
      <div class="result-item">
        <span class="account-badge ${info.className}">${info.short}</span>
        <div>
          <h4>${escapeHtml(item.title || '未命名资源')}</h4>
          <p>${escapeHtml(item.providerName || info.name)}${item.savedPath ? ` · ${escapeHtml(item.savedPath)}` : ''}</p>
          ${item.error ? `<p class="result-error">${escapeHtml(item.error)}</p>` : ''}
        </div>
        <div class="share-copy-box">
          ${link
            ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link)}</a><button class="soft-button" data-copy-result="${index}">复制</button>`
            : `<span class="result-error">无分享链接</span>`}
        </div>
        ${statusTag(item.status)}
      </div>
    `
  }).join('')
  $('transferResultsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onTransferProgress(event) {
  if (!event?.stage) return
  if (event.stage === 'processing') {
    setProgress(event.percent, `正在处理 ${event.index + 1} / ${event.total}`)
    updateProgressLog(`开始处理：${event.providerName} · ${event.title}`, 'is-active')
  } else if (event.stage === 'item-done') {
    const result = event.result
    setProgress(event.percent, `已完成 ${event.index + 1} / ${event.total}`)
    updateProgressLog(
      `${result.title || '资源'}：${statusLabel(result.status)}${result.error ? ` · ${result.error}` : ''}`,
      result.status === 'error' ? 'is-error' : ''
    )
  } else if (event.stage === 'complete') {
    setProgress(100, '本批处理完成')
    updateProgressLog(`完成，共 ${event.summary.results.length} 条结果。`)
    renderTransferResults(event.summary)
  }
}

async function runTransfer() {
  const text = $('smartText').value.trim()
  if (!text) return toast('请先粘贴分享文案', 'error')
  if (!state.parsed.length) {
    await parseSmartText()
  }
  if (!state.parsed.length) return toast('没有识别到百度 / 夸克 / 迅雷分享链接', 'error')

  const passcodes = {}
  document.querySelectorAll('.parsed-code').forEach((input) => {
    const link = state.parsed[Number(input.dataset.parsedIndex)]
    if (link) passcodes[link.url] = input.value.trim()
  })
  const autoShare = $('smartAutoShare').checked
  $('runTransfer').disabled = true
  $('transferResultsPanel').hidden = true
  $('progressLogs').innerHTML = ''
  setProgress(0, '准备任务')
  updateProgressLog('正在校验链接和本地账号…', 'is-active')

  try {
    const summary = await api.transfer({
      text,
      passcodes,
      targetPath: $('smartTarget').value.trim(),
      autoShare,
      expires: Number($('smartExpiry').value || 0),
      passcode: $('smartPasscode').value.trim()
    })
    state.history = await api.listHistory()
    state.shares = await api.listShares()
    renderStats()
    renderRecent()
    renderShares()
    toast('本批转存任务已处理完成')
    refreshUsage('', true).catch(() => {})
    return summary
  } catch (error) {
    setProgress(0, '任务失败')
    updateProgressLog(cleanError(error), 'is-error')
    toast(cleanError(error), 'error')
  } finally {
    $('runTransfer').disabled = false
  }
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function buildExportContent(format) {
  const results = state.result?.results || []
  const rows = results.map((item) => ({
    状态: statusLabel(item.status),
    网盘: item.providerName || providerInfo(item.provider).name,
    资源名称: item.title || '',
    分享链接: item.shareUrl || '',
    提取码: item.sharePasscode || '',
    转存目录: item.savedPath || '',
    错误: item.error || ''
  }))
  if (format === 'csv') {
    const headers = Object.keys(rows[0] || { 状态: '', 网盘: '', 资源名称: '', 分享链接: '', 提取码: '', 转存目录: '', 错误: '' })
    return '\ufeff' + [
      headers.map(csvCell).join(','),
      ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))
    ].join('\r\n')
  }
  if (format === 'md') {
    const lines = [
      '# 云梭本地版转存结果',
      '',
      `导出时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      '| 状态 | 网盘 | 资源名称 | 分享链接 | 提取码 |',
      '| --- | --- | --- | --- | --- |',
      ...rows.map((row) => `| ${row.状态} | ${row.网盘} | ${String(row.资源名称).replace(/\|/g, '\\|')} | ${row.分享链接} | ${row.提取码 || '—'} |`)
    ]
    return lines.join('\n')
  }
  return [
    '云梭本地版 · 本批转存结果',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    ...results.map((item) => [
      item.title || '未命名资源',
      `${item.providerName || providerInfo(item.provider).name} ${item.shareUrl || ''}`.trim(),
      item.sharePasscode ? `提取码 ${item.sharePasscode}` : '',
      `状态：${statusLabel(item.status)}${item.error ? ` · ${item.error}` : ''}`
    ].filter(Boolean).join('\n'))
  ].join('\n\n')
}

async function exportResults(format) {
  if (!state.result?.results?.length) return toast('暂无可导出的本批结果', 'error')
  try {
    const response = await api.exportResults({ format, content: buildExportContent(format) })
    if (response.ok) toast(`已导出到 ${response.filePath}`)
  } catch (error) {
    toast(cleanError(error), 'error')
  }
}

function renderFileAccounts() {
  const select = $('filesAccount')
  const previous = state.file.accountId || select.value
  select.innerHTML = state.accounts.length
    ? state.accounts.map((account) => `<option value="${account.id}">${escapeHtml(account.label)} · ${escapeHtml(providerInfo(account.provider).name)}</option>`).join('')
    : '<option value="">请先添加网盘账号</option>'
  const stillExists = state.accounts.some((account) => account.id === previous)
  state.file.accountId = stillExists ? previous : (state.accounts[0]?.id || '')
  select.value = state.file.accountId
  select.disabled = !state.accounts.length
}

function renderFileBreadcrumb() {
  if (state.file.searchMode) {
    $('fileBreadcrumb').innerHTML = '<button data-file-path="/">根目录</button><span>/</span><span>搜索结果</span>'
    return
  }
  const parts = state.file.path.split('/').filter(Boolean)
  const chunks = ['<button data-file-path="/">根目录</button>']
  let accumulated = ''
  for (const part of parts) {
    accumulated += `/${part}`
    chunks.push('<span>/</span>', `<button data-file-path="${escapeHtml(accumulated)}">${escapeHtml(part)}</button>`)
  }
  $('fileBreadcrumb').innerHTML = chunks.join('')
}

function renderFileList() {
  renderFileBreadcrumb()
  if (!state.file.items.length) {
    $('fileList').innerHTML = `<div class="empty-state"><b>${state.file.searchMode ? '没有搜索到文件' : '这个目录是空的'}</b><span>${state.file.searchMode ? '换一个关键词试试。' : '可以新建文件夹或切换到其他账号。'}</span></div>`
    return
  }
  $('fileList').innerHTML = state.file.items.map((item) => {
    const isDir = item.type === 'dir'
    return `
      <div class="file-row ${state.file.selectedPath === item.path ? 'is-selected' : ''}" data-file-path="${escapeHtml(item.path)}" data-file-type="${isDir ? 'dir' : 'file'}">
        <div class="file-name">
          <span class="file-icon ${isDir ? 'folder' : ''}">${isDir ? '夹' : '文'}</span>
          <strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
        </div>
        <small>${isDir ? '文件夹' : formatSize(item.size)}</small>
        <small>${formatDate(item.mtime)}</small>
        <div class="file-actions">
          ${isDir ? `<button data-file-action="open" data-file-path="${escapeHtml(item.path)}">打开</button>` : ''}
          <button data-file-action="rename" data-file-path="${escapeHtml(item.path)}" data-file-name="${escapeHtml(item.name)}">重命名</button>
          <button data-file-action="delete" data-file-path="${escapeHtml(item.path)}">删除</button>
        </div>
      </div>
    `
  }).join('')
}

async function loadFiles(path = '/') {
  if (!state.file.accountId) {
    state.file.items = []
    renderFileList()
    return
  }
  state.file.path = path || '/'
  state.file.searchMode = false
  state.file.selectedPath = ''
  $('fileList').innerHTML = '<div class="empty-state"><b>正在读取网盘目录…</b></div>'
  renderFileBreadcrumb()
  try {
    state.file.items = await api.listFiles({
      accountId: state.file.accountId,
      path: state.file.path
    })
    renderFileList()
  } catch (error) {
    state.file.items = []
    $('fileList').innerHTML = `<div class="empty-state"><b>目录读取失败</b><span>${escapeHtml(cleanError(error))}</span></div>`
  }
}

async function searchFiles() {
  const keyword = $('fileSearchInput').value.trim()
  if (!state.file.accountId) return toast('请先添加网盘账号', 'error')
  if (!keyword) return loadFiles(state.file.path)
  $('fileList').innerHTML = '<div class="empty-state"><b>正在搜索…</b></div>'
  try {
    state.file.items = await api.searchFiles({
      accountId: state.file.accountId,
      keyword
    })
    state.file.searchMode = true
    state.file.selectedPath = ''
    renderFileList()
  } catch (error) {
    state.file.items = []
    $('fileList').innerHTML = `<div class="empty-state"><b>搜索失败</b><span>${escapeHtml(cleanError(error))}</span></div>`
  }
}

async function fileOperation(action, payload = {}) {
  if (!state.file.accountId) return toast('请先添加网盘账号', 'error')
  try {
    await api.fileOperation({
      accountId: state.file.accountId,
      action,
      ...payload
    })
    toast('文件操作已完成')
    await loadFiles(state.file.path)
  } catch (error) {
    toast(cleanError(error), 'error')
  }
}

function renderShares() {
  const filter = $('shareProviderFilter').value
  const rows = state.shares.filter((item) => !filter || item.provider === filter)
  $('shareLibrarySummary').textContent = rows.length
    ? `共 ${rows.length} 条分享，Cookie 和分享记录都只保存在本机。`
    : '本机生成过的分享会保存在这里。'
  $('shareList').innerHTML = rows.length ? rows.map((item) => `
    <div class="share-row">
      ${providerIcon(item.provider)}
      <div>
        <h4>${escapeHtml(item.title || '未命名资源')}</h4>
        <p>${escapeHtml(item.providerName || providerInfo(item.provider).name)} · ${escapeHtml(formatDate(item.createdAt))} · ${item.expires === 0 ? '永久有效' : `${escapeHtml(item.expires)} 天有效`}${item.passcode ? ` · 提取码 ${escapeHtml(item.passcode)}` : ''}</p>
      </div>
      <div class="share-link">
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.url)}</a>
        <button class="soft-button" data-copy-share="${item.id}">复制</button>
      </div>
      <div class="account-actions">
        <button class="icon-button" data-open-share="${item.id}" title="打开链接">↗</button>
        <button class="icon-button" data-delete-share="${item.id}" title="从分享库删除">×</button>
      </div>
    </div>
  `).join('') : '<div class="empty-state"><b>分享库还是空的</b><span>完成一次开启分享的转存后会出现在这里。</span></div>'
}

function renderMonitorAccounts() {
  const select = $('monitorAccount')
  const previous = select.value
  select.innerHTML = state.accounts.length
    ? state.accounts.map((account) => `<option value="${account.id}">${escapeHtml(account.label)} · ${escapeHtml(providerInfo(account.provider).name)}</option>`).join('')
    : '<option value="">请先添加网盘账号</option>'
  if (state.accounts.some((account) => account.id === previous)) select.value = previous
  select.disabled = !state.accounts.length
}

function renderMonitors() {
  $('monitorCount').textContent = `${state.monitors.length} 个`
  $('monitorList').innerHTML = state.monitors.length ? state.monitors.map((monitor) => {
    const statusClass = ['error', 'waiting'].includes(monitor.status) ? monitor.status : ''
    return `
      <div class="monitor-row">
        <div class="monitor-row-head">
          <div>
            <strong>${escapeHtml(monitor.lastTitle || monitor.url)}</strong>
            <small>${escapeHtml(monitor.providerName)} · 每 ${escapeHtml(monitor.intervalMinutes)} 分钟</small>
          </div>
          <span class="monitor-state ${statusClass}"><i></i>${escapeHtml(statusLabel(monitor.status))}</span>
        </div>
        <div class="monitor-meta">
          <span>同步目录：${escapeHtml(monitor.targetPath)}</span>
          <span>上次：${escapeHtml(formatDate(monitor.lastCheckedAt))}</span>
          <span>下次：${escapeHtml(formatDate(monitor.nextCheckAt))}</span>
          <span>${monitor.autoShare ? '自动创建分享' : '仅同步文件'}</span>
        </div>
        ${monitor.lastError ? `<p class="monitor-error">${escapeHtml(monitor.lastError)}</p>` : ''}
        <div class="monitor-actions">
          <button class="soft-button" data-monitor-run="${monitor.id}">立即检查</button>
          <button class="soft-button" data-monitor-toggle="${monitor.id}">${monitor.enabled ? '暂停' : '继续'}</button>
          <button class="soft-button" data-monitor-delete="${monitor.id}">删除</button>
        </div>
      </div>
    `
  }).join('') : '<div class="empty-state"><b>还没有监控任务</b><span>在左侧粘贴一个会持续更新的分享链接。</span></div>'
}

function renderSettings() {
  if (!state.settings) return
  applyTheme(state.settings.theme)
  $('defaultTargetMode').value = state.settings.defaultTargetMode || 'today'
  $('customTargetPath').value = state.settings.customTargetPath || ''
  $('customTargetField').hidden = state.settings.defaultTargetMode !== 'custom'
  $('defaultPasscode').value = state.settings.defaultPasscode || '8888'
  $('defaultExpiry').value = String(state.settings.defaultExpiry || 0)
  $('smartPasscode').value = state.settings.defaultPasscode || '8888'
  $('smartExpiry').value = String(state.settings.defaultExpiry || 0)
  $('monitorSharePasscode').value = state.settings.defaultPasscode || '8888'
}

async function saveSettings(patch = {}) {
  const payload = {
    theme: state.settings.theme,
    defaultTargetMode: $('defaultTargetMode').value,
    customTargetPath: $('customTargetPath').value,
    defaultPasscode: $('defaultPasscode').value,
    defaultExpiry: Number($('defaultExpiry').value || 0),
    ...patch
  }
  state.settings = await api.updateSettings(payload)
  renderSettings()
  return state.settings
}

function closeDialog() {
  $('dialogOverlay').hidden = true
  $('dialogConfirm').disabled = false
  dialogHandler = null
}

function openDialog({
  title,
  eyebrow = 'YUNSUO LOCAL',
  body,
  confirmText = '确认',
  cancelText = '取消',
  showConfirm = true,
  onConfirm
}) {
  $('dialogTitle').textContent = title
  $('dialogEyebrow').textContent = eyebrow
  $('dialogBody').innerHTML = body
  $('dialogConfirm').textContent = confirmText
  $('dialogConfirm').hidden = !showConfirm
  $('dialogCancel').textContent = cancelText
  $('dialogOverlay').hidden = false
  dialogHandler = onConfirm || null
  setTimeout(() => {
    const firstInput = $('dialogBody').querySelector('input, textarea, select')
    firstInput?.focus()
    firstInput?.select?.()
  }, 70)
}

async function confirmDialog({ title, message, confirmText = '确认', danger = false, onConfirm }) {
  openDialog({
    title,
    confirmText,
    body: `<p>${escapeHtml(message)}</p>${danger ? '<div class="dialog-warning">此操作会直接作用到你的网盘账号，请确认后继续。</div>' : ''}`,
    onConfirm
  })
}

function openCookieDialog(providerId, account = null) {
  const provider = providerInfo(providerId)
  openDialog({
    title: account ? '更新网盘账号' : `连接${provider.name}`,
    eyebrow: 'ENCRYPTED COOKIE',
    confirmText: account ? '保存更新' : '保存账号',
    body: `
      <p>${account ? '可以修改显示名称；如需更新 Cookie，将其粘贴到下方。' : '从浏览器开发者工具复制网盘网页登录 Cookie。凭据将用 Windows 安全存储加密保存在本机。'}</p>
      <label class="field">
        <span>账号名称</span>
        <input id="accountLabelInput" type="text" maxlength="80" value="${escapeHtml(account?.label || provider.name)}" />
      </label>
      <label class="field">
        <span>Cookie ${account ? '（留空则不修改）' : ''}</span>
        <textarea id="accountCookieInput" style="width:100%;min-height:105px;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--surface-soft);color:var(--ink);font:8px/1.6 var(--mono)" spellcheck="false" placeholder="BDUSS=…; STOKEN=…"></textarea>
      </label>
    `,
    onConfirm: async () => {
      const label = $('accountLabelInput').value.trim()
      const cookie = $('accountCookieInput').value.trim()
      if (!account && !cookie) throw new Error('请填写 Cookie，或使用扫码登录')
      const saved = account
        ? await api.updateAccount({ id: account.id, label, ...(cookie ? { cookie } : {}) })
        : await api.addAccount({ provider: providerId, label, cookie })
      state.accounts = await api.listAccounts()
      renderAccounts()
      toast(account ? '网盘账号已更新' : '网盘账号已连接')
      refreshUsage(saved.id).catch(() => {})
    }
  })
}

function stopQr() {
  if (qrPollTimer) clearInterval(qrPollTimer)
  qrPollTimer = null
  qrPollBusy = false
  qrProvider = ''
  qrToken = ''
  $('qrOverlay').hidden = true
}

async function startQr(providerId) {
  stopQr()
  qrProvider = providerId
  const provider = providerInfo(providerId)
  $('qrProviderLabel').textContent = `${provider.name}扫码登录`
  $('qrTitle').textContent = `连接${provider.name}`
  $('qrImage').removeAttribute('src')
  $('qrImage').hidden = true
  $('qrLoading').innerHTML = '<i></i><span>正在生成二维码</span>'
  $('qrLoading').hidden = false
  $('qrStatusText').textContent = '正在生成二维码…'
  $('qrOverlay').hidden = false

  try {
    const session = await api.qrStart(providerId)
    qrToken = session.token
    if (session.qrImage) {
      $('qrImage').src = session.qrImage
      $('qrImage').hidden = false
      $('qrLoading').hidden = true
    }
    $('qrStatusText').textContent = '请使用对应网盘 App 扫码'
    qrPollTimer = setInterval(pollQr, 2000)
  } catch (error) {
    $('qrStatusText').textContent = cleanError(error)
    $('qrLoading').innerHTML = '<span>二维码获取失败，请关闭后重试</span>'
  }
}

async function pollQr() {
  if (!qrProvider || !qrToken || qrPollBusy) return
  qrPollBusy = true
  try {
    const result = await api.qrPoll({ provider: qrProvider, token: qrToken })
    if (result.status === 'pending') {
      $('qrStatusText').textContent = '等待扫码…'
    } else if (result.status === 'scanned') {
      $('qrStatusText').textContent = '已扫码，请在手机上确认'
    } else if (result.status === 'expired') {
      $('qrStatusText').textContent = '二维码已过期，请关闭后重新获取'
      clearInterval(qrPollTimer)
      qrPollTimer = null
    } else if (result.status === 'confirmed') {
      $('qrStatusText').textContent = '登录成功，凭据已保存到本机'
      clearInterval(qrPollTimer)
      qrPollTimer = null
      state.accounts = await api.listAccounts()
      renderAccounts()
      toast(`${providerInfo(qrProvider).name}已连接`)
      setTimeout(stopQr, 650)
      refreshUsage().catch(() => {})
    }
  } catch (error) {
    $('qrStatusText').textContent = `状态查询失败：${cleanError(error)}`
  } finally {
    qrPollBusy = false
  }
}

async function handleAccountAction(action, id) {
  const account = state.accounts.find((item) => item.id === id)
  if (!account) return
  if (action === 'usage') return refreshUsage(id)
  if (action === 'edit') return openCookieDialog(account.provider, account)
  if (action === 'delete') {
    return confirmDialog({
      title: '删除网盘账号',
      message: `确定删除「${account.label}」吗？与该账号绑定的本地监控也会一并删除。`,
      confirmText: '删除账号',
      danger: true,
      onConfirm: async () => {
        await api.deleteAccount(account.id)
        state.accounts = await api.listAccounts()
        state.monitors = await api.listMonitors()
        delete state.usages[account.id]
        renderAccounts()
        renderMonitors()
        renderStats()
        toast('网盘账号已删除')
      }
    })
  }
}

function promptRename(path, currentName) {
  openDialog({
    title: '重命名',
    confirmText: '保存名称',
    body: `
      <label class="field"><span>新名称</span><input id="renameInput" type="text" value="${escapeHtml(currentName)}" /></label>
    `,
    onConfirm: async () => {
      const name = $('renameInput').value.trim()
      if (!name) throw new Error('请输入新名称')
      await fileOperation('rename', { path, name })
    }
  })
}

function promptDestination(action, path) {
  const isCopy = action === 'copy'
  openDialog({
    title: isCopy ? '复制到…' : '移动到…',
    confirmText: isCopy ? '开始复制' : '开始移动',
    body: `
      <p>目标目录必须已经存在。目录路径以 / 开头。</p>
      <label class="field"><span>目标目录</span><input id="destinationInput" type="text" value="${escapeHtml(state.file.path)}" spellcheck="false" /></label>
    `,
    onConfirm: async () => {
      const destination = $('destinationInput').value.trim()
      if (!destination) throw new Error('请输入目标目录')
      await fileOperation(action, { paths: [path], destination })
    }
  })
}

function promptMkdir() {
  openDialog({
    title: '新建文件夹',
    confirmText: '创建',
    body: `<label class="field"><span>文件夹名称</span><input id="mkdirInput" type="text" placeholder="新文件夹" /></label>`,
    onConfirm: async () => {
      const name = $('mkdirInput').value.trim()
      if (!name) throw new Error('请输入文件夹名称')
      await fileOperation('mkdir', { parent: state.file.path, name })
    }
  })
}

async function handleFileAction(action, target, name) {
  if (!state.file.accountId) return toast('请先添加网盘账号', 'error')
  if (action === 'open') {
    if (state.file.searchMode) {
      state.file.searchMode = false
      await loadFiles(target)
    } else {
      await loadFiles(target)
    }
    return
  }
  if (action === 'rename') return promptRename(target, name)
  if (action === 'delete') {
    return confirmDialog({
      title: '删除网盘文件',
      message: `确定删除「${target}」吗？文件会进入网盘回收站或按对应网盘规则处理。`,
      confirmText: '确认删除',
      danger: true,
      onConfirm: () => fileOperation('delete', { paths: [target] })
    })
  }
}

async function addMonitor() {
  if (!state.accounts.length) return toast('请先连接一个网盘账号', 'error')
  const url = $('monitorUrl').value.trim()
  if (!url) return toast('请填写分享链接', 'error')
  $('addMonitor').disabled = true
  try {
    await api.addMonitor({
      url,
      accountId: $('monitorAccount').value,
      intervalMinutes: Number($('monitorInterval').value),
      passcode: $('monitorPasscode').value.trim(),
      targetPath: $('monitorTarget').value.trim(),
      autoShare: $('monitorAutoShare').checked,
      sharePasscode: $('monitorSharePasscode').value.trim()
    })
    state.monitors = await api.listMonitors()
    $('monitorUrl').value = ''
    $('monitorPasscode').value = ''
    renderMonitors()
    renderStats()
    toast('监控任务已创建，将在后台进行首次检查')
  } catch (error) {
    toast(cleanError(error), 'error')
  } finally {
    $('addMonitor').disabled = false
  }
}

async function handleMonitorAction(action, id) {
  const monitor = state.monitors.find((item) => item.id === id)
  if (!monitor) return
  try {
    if (action === 'run') {
      toast('正在检查源分享，请稍候…')
      const result = await api.runMonitor(id)
      state.monitors = await api.listMonitors()
      renderMonitors()
      state.history = await api.listHistory()
      state.shares = await api.listShares()
      renderStats()
      renderRecent()
      renderShares()
      toast(result.changed ? '发现更新并已完成同步' : '已检查，源资源没有变化')
    } else if (action === 'toggle') {
      await api.updateMonitor({ id, enabled: !monitor.enabled })
      state.monitors = await api.listMonitors()
      renderMonitors()
      renderStats()
    } else if (action === 'delete') {
      await confirmDialog({
        title: '删除链接监控',
        message: `确定停止并删除「${monitor.lastTitle || monitor.url}」吗？`,
        confirmText: '删除监控',
        danger: true,
        onConfirm: async () => {
          await api.deleteMonitor(id)
          state.monitors = await api.listMonitors()
          renderMonitors()
          renderStats()
          toast('监控已删除')
        }
      })
    }
  } catch (error) {
    toast(cleanError(error), 'error')
  }
}

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const nav = event.target.closest('[data-view]')
    if (nav) {
      setView(nav.dataset.view)
      return
    }

    const qrButton = event.target.closest('[data-qr-provider]')
    if (qrButton) return startQr(qrButton.dataset.qrProvider)

    const cookieButton = event.target.closest('[data-cookie-provider]')
    if (cookieButton) return openCookieDialog(cookieButton.dataset.cookieProvider)

    const accountButton = event.target.closest('[data-account-action]')
    if (accountButton) {
      return handleAccountAction(accountButton.dataset.accountAction, accountButton.dataset.accountId)
    }

    const copyResult = event.target.closest('[data-copy-result]')
    if (copyResult) {
      const item = state.result?.results?.[Number(copyResult.dataset.copyResult)]
      if (item && await copyText(shareTextFor({
        title: item.title,
        provider: item.provider,
        providerName: item.providerName,
        url: item.shareUrl,
        passcode: item.sharePasscode
      }))) toast('分享文案已复制')
      return
    }

    const copyShare = event.target.closest('[data-copy-share]')
    if (copyShare) {
      const item = state.shares.find((share) => share.id === copyShare.dataset.copyShare)
      if (item && await copyText(shareTextFor(item))) toast('分享文案已复制')
      return
    }

    const openShare = event.target.closest('[data-open-share]')
    if (openShare) {
      const item = state.shares.find((share) => share.id === openShare.dataset.openShare)
      if (item) await api.openExternal(item.url)
      return
    }

    const deleteShare = event.target.closest('[data-delete-share]')
    if (deleteShare) {
      const item = state.shares.find((share) => share.id === deleteShare.dataset.deleteShare)
      if (!item) return
      return confirmDialog({
        title: '从分享库删除',
        message: `仅删除本机记录，不会删除网盘里已经创建的分享。确定删除「${item.title}」吗？`,
        confirmText: '删除记录',
        danger: true,
        onConfirm: async () => {
          await api.deleteShare(item.id)
          state.shares = await api.listShares()
          renderShares()
          renderStats()
        }
      })
    }

    const fileAction = event.target.closest('[data-file-action]')
    if (fileAction) {
      event.stopPropagation()
      return handleFileAction(
        fileAction.dataset.fileAction,
        fileAction.dataset.filePath,
        fileAction.dataset.fileName || ''
      )
    }

    const filePath = event.target.closest('[data-file-path]')
    if (filePath && !event.target.closest('[data-file-action]')) {
      if (filePath.classList.contains('file-row')) {
        state.file.selectedPath = filePath.dataset.filePath
        document.querySelectorAll('.file-row').forEach((row) => {
          row.classList.toggle('is-selected', row.dataset.filePath === state.file.selectedPath)
        })
      } else {
        state.file.searchMode = false
        await loadFiles(filePath.dataset.filePath)
      }
      return
    }

    const monitorRun = event.target.closest('[data-monitor-run]')
    if (monitorRun) return handleMonitorAction('run', monitorRun.dataset.monitorRun)
    const monitorToggle = event.target.closest('[data-monitor-toggle]')
    if (monitorToggle) return handleMonitorAction('toggle', monitorToggle.dataset.monitorToggle)
    const monitorDelete = event.target.closest('[data-monitor-delete]')
    if (monitorDelete) return handleMonitorAction('delete', monitorDelete.dataset.monitorDelete)

    const theme = event.target.closest('[data-theme-choice]')
    if (theme) {
      applyTheme(theme.dataset.themeChoice)
      try {
        await saveSettings({ theme: theme.dataset.themeChoice })
        toast('主题已切换并保存')
      } catch (error) {
        toast(cleanError(error), 'error')
      }
    }
  })

  document.addEventListener('dblclick', (event) => {
    const row = event.target.closest('.file-row')
    if (row?.dataset.fileType === 'dir') {
      loadFiles(row.dataset.filePath)
    }
  })

  $('mainNav').addEventListener('click', () => {})
  $('dashboardParse').addEventListener('click', () => {
    const value = $('dashboardPaste').value.trim()
    if (!value) return toast('请先粘贴分享文案', 'error')
    $('smartText').value = value
    setView('transfer')
    parseSmartText()
  })
  $('smartText').addEventListener('input', queueParse)
  $('smartText').addEventListener('paste', () => setTimeout(queueParse, 0))
  $('pasteFromClipboard').addEventListener('click', async () => {
    try {
      $('smartText').value = await navigator.clipboard.readText()
      parseSmartText()
    } catch {
      toast('无法读取剪贴板，请手动粘贴', 'error')
    }
  })
  $('clearSmartText').addEventListener('click', () => {
    $('smartText').value = ''
    state.parsed = []
    renderParsedLinks()
    $('smartText').focus()
  })
  $('smartAutoShare').addEventListener('change', () => {
    $('shareOptions').hidden = !$('smartAutoShare').checked
  })
  $('runTransfer').addEventListener('click', runTransfer)
  $('copyBatchText').addEventListener('click', async () => {
    const text = state.result?.shareText || buildBatchText(state.result?.results || [])
    if (await copyText(text)) toast('本批分享文案已复制')
  })
  $('exportTxt').addEventListener('click', () => exportResults('txt'))
  $('exportCsv').addEventListener('click', () => exportResults('csv'))
  $('exportMd').addEventListener('click', () => exportResults('md'))

  $('refreshAllUsage').addEventListener('click', () => refreshUsage())
  $('filesAccount').addEventListener('change', (event) => {
    state.file.accountId = event.target.value
    loadFiles('/')
  })
  $('filesHome').addEventListener('click', () => loadFiles('/'))
  $('fileSearchButton').addEventListener('click', searchFiles)
  $('fileSearchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchFiles()
  })
  $('mkdirButton').addEventListener('click', promptMkdir)
  $('copyFilesButton').addEventListener('click', () => {
    if (!state.file.selectedPath) return toast('请先选择一个文件或文件夹', 'error')
    const account = state.accounts.find((item) => item.id === state.file.accountId)
    const provider = state.providers.find((item) => item.id === account?.provider)
    if (provider && provider.operations?.copy === false) return toast('当前网盘不支持复制文件', 'error')
    promptDestination('copy', state.file.selectedPath)
  })
  $('moveFilesButton').addEventListener('click', () => {
    if (!state.file.selectedPath) return toast('请先选择一个文件或文件夹', 'error')
    promptDestination('move', state.file.selectedPath)
  })

  $('shareProviderFilter').addEventListener('change', renderShares)
  $('copyAllShares').addEventListener('click', async () => {
    const filter = $('shareProviderFilter').value
    const text = state.shares
      .filter((item) => !filter || item.provider === filter)
      .map(shareTextFor)
      .join('\n\n')
    if (await copyText(text)) toast('分享库文案已复制')
  })

  $('addMonitor').addEventListener('click', addMonitor)
  $('monitorUrl').addEventListener('blur', async () => {
    const url = $('monitorUrl').value.trim()
    if (!url || $('monitorPasscode').value.trim()) return
    try {
      const [link] = await api.parse(url)
      if (link?.passcode) $('monitorPasscode').value = link.passcode
    } catch {
      // The URL is validated again when the monitor is created.
    }
  })

  $('defaultTargetMode').addEventListener('change', () => {
    $('customTargetField').hidden = $('defaultTargetMode').value !== 'custom'
  })
  $('savePreferences').addEventListener('click', async () => {
    try {
      await saveSettings()
      $('smartTarget').value = getDefaultTarget()
      toast('转存偏好已保存')
    } catch (error) {
      toast(cleanError(error), 'error')
    }
  })
  $('openDataButton').addEventListener('click', () => api.showDataFolder())
  $('openDataSidebar').addEventListener('click', () => api.showDataFolder())

  $('dialogClose').addEventListener('click', closeDialog)
  $('dialogCancel').addEventListener('click', closeDialog)
  $('dialogOverlay').addEventListener('click', (event) => {
    if (event.target === $('dialogOverlay')) closeDialog()
  })
  $('dialogConfirm').addEventListener('click', async () => {
    if (!dialogHandler) return closeDialog()
    $('dialogConfirm').disabled = true
    try {
      const keepOpen = await dialogHandler()
      if (keepOpen !== false) closeDialog()
    } catch (error) {
      toast(cleanError(error), 'error')
    } finally {
      $('dialogConfirm').disabled = false
    }
  })
  $('qrCancel').addEventListener('click', stopQr)
  $('qrOverlay').addEventListener('click', (event) => {
    if (event.target === $('qrOverlay')) stopQr()
  })
}

async function init() {
  bindEvents()
  try {
    const [info, providers, accounts, history, shares, monitors, settings] = await Promise.all([
      api.info(),
      api.providers(),
      api.listAccounts(),
      api.listHistory(),
      api.listShares(),
      api.listMonitors(),
      api.getSettings()
    ])
    state.info = info
    state.providers = providers
    state.accounts = accounts
    state.history = history
    state.shares = shares
    state.monitors = monitors
    state.settings = settings
    applyTheme(settings.theme)
    $('smartTarget').value = getDefaultTarget()
    $('appVersion').textContent = `LOCAL V${info.version}`
    $('aboutVersion').textContent = `VERSION ${info.version} · ELECTRON ${info.electron}`
    renderAll()
    renderParsedLinks()
    refreshUsage('', true).catch(() => {})
  } catch (error) {
    toast(`本地程序初始化失败：${cleanError(error)}`, 'error')
  }
}

api.onTransferProgress(onTransferProgress)
api.onMonitorChanged((monitor) => {
  const index = state.monitors.findIndex((item) => item.id === monitor.id)
  if (index >= 0) state.monitors[index] = monitor
  else state.monitors.unshift(monitor)
  renderMonitors()
  renderStats()
})

init()
