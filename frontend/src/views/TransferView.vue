<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { api } from '../api.js'
import { store } from '../store.js'
import { notify } from '../toast.js'
import FolderPickerModal from '../components/FolderPickerModal.vue'

const emit = defineEmits(['changed'])

const text = ref('')
const links = ref([])
const parsing = ref(false)
const submitting = ref(false)
const batch = ref(null)
const batchTasks = ref([])
const batchShares = ref([])
const batchSkipped = ref([])
const pollState = ref('idle')
const resultsEl = ref(null)
const targetPathTouched = ref(false)
const passcodeTouched = ref(false)
const defaultTargetPath = todayTransferPath()
const form = ref({
  accountId: '',
  targetPath: defaultTargetPath,
  autoShare: true,
  expires: 7,
  unlimited: true,
  passcodeEnabled: true,
  sharePasscode: '8888'
})
const folderPickerOpen = ref(false)
let pollTimer = null
let pollGeneration = 0
let finalNoticeShown = false

function todayTransferPath() {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `/转存/${value.year}-${value.month}-${value.day}`
}

const providerMeta = {
  baidu: { label: '百度网盘', cls: 'teal', mark: '百' },
  quark: { label: '夸克网盘', cls: 'blue', mark: '夸' },
  xunlei: { label: '迅雷网盘', cls: 'gold', mark: '迅' },
  demo: { label: '演示空间', cls: 'coral', mark: '演' }
}

const matchingAccounts = computed(() => {
  const ids = new Set(links.value.map((l) => l.provider))
  return store.accounts.filter((a) => ids.has(a.provider))
})
const hasQuarkLink = computed(() => links.value.some((link) => link.provider === 'quark'))

const samples = [
  {
    label: '混合文案',
    text: `课程资料合集
链接: https://pan.baidu.com/s/1AbCdEf_123 提取码: qwer
设计素材（无提取码）
https://pan.quark.cn/s/8f3c2a91d7
影视资源
https://pan.xunlei.com/s/VN9x2KpQr7 提取码: 3m8n`
  },
  { label: '夸克示例', text: '链接: https://pan.quark.cn/s/8f3c2a91d7 提取码: 7k2x' },
  { label: '百度示例', text: 'https://pan.baidu.com/s/1AbCdEf_123?pwd=qwer 提取码: qwer' },
  { label: '迅雷示例', text: 'https://pan.xunlei.com/s/VN9x2KpQr7 提取码: 3m8n' }
]

const accountMap = computed(() => new Map(store.accounts.map((account) => [account.id, account])))

const batchRunning = computed(() => {
  if (!batch.value) return false
  return batchTasks.value.some((task) => ['queued', 'running'].includes(task.status))
})

const completedCount = computed(() => batchTasks.value.filter((task) => ['done', 'error', 'canceled'].includes(task.status)).length)

const batchProgress = computed(() => {
  const count = batchTasks.value.length
  if (!count) return batchSkipped.value.length ? 100 : 0
  const progress = batchTasks.value.reduce((sum, task) => {
    if (task.status === 'done') return sum + 100
    if (['error', 'canceled'].includes(task.status)) return sum + 100
    return sum + Math.max(0, Math.min(100, Number(task.progress || 0)))
  }, 0)
  return Math.round(progress / count)
})

const resultRows = computed(() => {
  const byTask = new Map(batchShares.value.filter((share) => share.taskId).map((share) => [share.taskId, share]))
  const rows = batchTasks.value.map((task) => {
    const meta = task.detail || {}
    const account = accountMap.value.get(meta.accountId)
    const share = byTask.get(task.id) || null
    const title = String(task.title || '').replace(/^[^·]+·\s*/, '') || `链接 ${task.id.slice(-6)}`
    return {
      id: task.id,
      status: task.status,
      provider: meta.provider,
      accountLabel: account?.label || '已移除账号',
      name: share?.title || title,
      url: share?.url || '',
      passcode: share?.passcode || '',
      expires: share?.expires,
      targetPath: meta.targetPath || '/',
      error: task.error || '',
      progress: Number(task.progress || 0),
      sourceUrl: meta.url || ''
    }
  })
  const skipped = batchSkipped.value.map((item, index) => {
    const parsed = links.value.find((link) => link.url === item.url)
    return {
      id: `skip_${index}`,
      status: 'error',
      provider: parsed?.provider || '',
      accountLabel: '未匹配账号',
      name: parsed?.key || item.url,
      url: '',
      passcode: '',
      expires: null,
      targetPath: '',
      error: item.reason || '未创建转存任务',
      progress: 100,
      sourceUrl: item.url || ''
    }
  })
  return [...rows, ...skipped]
})

const successCount = computed(() => batchTasks.value.filter((task) => task.status === 'done').length)
const failedCount = computed(() => (
  batchTasks.value.filter((task) => ['error', 'canceled'].includes(task.status)).length + batchSkipped.value.length
))
const shareCount = computed(() => batchShares.value.length)

const browseAccount = computed(() => {
  if (form.value.accountId) return store.accounts.find((a) => a.id === form.value.accountId) || null
  return matchingAccounts.value[0] || store.accounts[0] || null
})

function useSample(sample) {
  text.value = sample.text
  parse()
}

async function parse() {
  if (!text.value.trim()) return notify('先粘贴一段分享文案', 'error')
  parsing.value = true
  try {
    const data = await api.post('/parse', { text: text.value })
    links.value = data.links
    applyPasscodeDefault(data.links)
    form.value.accountId = ''
    notify(`识别到 ${data.links.length} 个链接`, 'success')
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    parsing.value = false
  }
}

function removeLink(index) {
  links.value.splice(index, 1)
  if (!passcodeTouched.value) applyPasscodeDefault(links.value)
}

function randomPasscode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  form.value.sharePasscode = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  form.value.passcodeEnabled = true
  passcodeTouched.value = true
}

function setPasscodeEnabled(enabled) {
  form.value.passcodeEnabled = enabled
  passcodeTouched.value = true
}

function applyPasscodeDefault(nextLinks) {
  passcodeTouched.value = false
  form.value.sharePasscode = '8888'
  form.value.passcodeEnabled = !nextLinks.length || !nextLinks.every((link) => link.provider === 'quark')
}

function openFolderPicker() {
  if (!browseAccount.value) return notify('请先连接一个网盘账号', 'error')
  folderPickerOpen.value = true
}

function chooseFolder(path) {
  form.value.targetPath = path
  targetPathTouched.value = true
}

async function submit() {
  if (!links.value.length) return notify('先识别链接再开始转存', 'error')
  if (!store.accounts.length) {
    notify('还没有网盘账号,先去添加一个', 'error')
    store.page = 'accounts'
    return
  }
  if (form.value.autoShare && form.value.passcodeEnabled && !/^[A-Z0-9]{4}$/.test(form.value.sharePasscode)) {
    return notify('请输入 4 位分享提取码，或选择无提取码', 'error')
  }
  submitting.value = true
  try {
    if (!targetPathTouched.value) form.value.targetPath = todayTransferPath()
    stopPolling()
    batch.value = null
    batchTasks.value = []
    batchShares.value = []
    batchSkipped.value = []
    finalNoticeShown = false
    const data = await api.post('/transfer', {
      text: text.value,
      links: links.value,
      accountId: form.value.accountId || undefined,
      targetPath: form.value.targetPath,
      autoShare: form.value.autoShare,
      unlimited: form.value.unlimited,
      expires: form.value.expires,
      sharePasscode: form.value.autoShare && form.value.passcodeEnabled ? form.value.sharePasscode : ''
    })
    batch.value = { id: data.batchId, createdAt: Date.now(), autoShare: form.value.autoShare }
    batchTasks.value = []
    batchSkipped.value = data.skipped || []
    pollState.value = 'running'
    notify(`已创建 ${data.tasks.length} 个转存任务`, 'success')
    for (const skip of data.skipped || []) notify(skip.reason, 'error')
    emit('changed')
    await nextTick()
    resultsEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    startPolling(data.batchId)
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    submitting.value = false
  }
}

function providerLabel(id) {
  return providerMeta[id]?.label || id || '未知网盘'
}

function statusLabel(task) {
  if (task.status === 'done') return '已转存'
  if (task.status === 'running') return `转存中 ${task.progress || 0}%`
  if (task.status === 'queued') return '排队中'
  if (task.status === 'canceled') return '已取消'
  return '转存失败'
}

function expiryLabel(expires) {
  if (expires === null || expires === undefined || expires === '') return '—'
  return Number(expires) > 0 ? `${expires} 天` : '永久有效'
}

async function copyText(text, message = '已复制') {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    notify(message, 'success')
  } catch {
    notify('复制失败，请手动选择文本', 'error')
  }
}

function shareCopyText(row) {
  return [
    row.name,
    row.url,
    row.passcode ? `提取码: ${row.passcode}` : ''
  ].filter(Boolean).join('\n')
}

function batchCopyText() {
  return resultRows.value
    .filter((row) => row.url)
    .map((row) => {
      const passcode = row.passcode ? ` 提取码: ${row.passcode}` : ''
      return `${row.name}\n${providerLabel(row.provider)} ${row.url}${passcode}`
    })
    .join('\n')
}

function stopPolling() {
  pollGeneration++
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

function startPolling(batchId) {
  const generation = ++pollGeneration
  const tick = async () => {
    if (!batch.value || batch.value.id !== batchId || generation !== pollGeneration) return
    try {
      const [tasks, shares] = await Promise.all([
        api.get(`/tasks?batchId=${encodeURIComponent(batchId)}&limit=100`),
        api.get(`/shares?batchId=${encodeURIComponent(batchId)}`)
      ])
      if (generation !== pollGeneration) return
      batchTasks.value = Array.isArray(tasks) ? tasks : []
      batchShares.value = Array.isArray(shares) ? shares : []
      const active = batchTasks.value.some((task) => ['queued', 'running'].includes(task.status))
      pollState.value = active ? 'running' : 'done'
      if (active) {
        pollTimer = setTimeout(tick, 1200)
        return
      }
      pollTimer = null
      if (!finalNoticeShown) {
        finalNoticeShown = true
        const failed = failedCount.value
        notify(
          failed
            ? `本批次已结束，${successCount.value} 个成功，${failed} 个失败`
            : `本批次 ${successCount.value} 个链接已全部转存完成`,
          failed ? 'error' : 'success'
        )
        emit('changed')
      }
    } catch (err) {
      if (generation !== pollGeneration) return
      pollState.value = 'error'
      notify(`读取批次结果失败：${err.message}`, 'error')
    }
  }
  tick()
}

function exportRows() {
  return resultRows.value.map((row, index) => ({
    index: index + 1,
    status: statusLabel(row),
    provider: providerLabel(row.provider),
    account: row.accountLabel,
    name: row.name,
    url: row.url || '',
    passcode: row.passcode || '',
    expiry: expiryLabel(row.expires),
    targetPath: row.targetPath || '',
    error: row.error || '',
    sourceUrl: row.sourceUrl || '',
    id: row.id
  }))
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function resultText() {
  const rows = exportRows()
  if (!rows.length) return ''
  return rows.map((row) => [
    `${String(row.index).padStart(2, '0')}｜${row.status}｜${row.provider}`,
    `资源：${row.name}`,
    `账号：${row.account}`,
    `分享：${row.url || '未生成'}`,
    `提取码：${row.passcode || '无'}`,
    `有效期：${row.expiry}`,
    row.targetPath ? `目录：${row.targetPath}` : '',
    row.error ? `原因：${row.error}` : '',
    `源链接：${row.sourceUrl}`
  ].filter(Boolean).join('\n')).join('\n\n')
}

function downloadFile(content, extension, mime) {
  const date = new Date()
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('') + '-' + [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0')
  ].join('')
  const bom = extension === 'csv' ? '\ufeff' : ''
  const blob = new Blob([bom + content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `yunsuo-batch-${stamp}.${extension}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  notify(`已导出 ${extension.toUpperCase()}`, 'success')
}

function exportResult(kind) {
  const rows = exportRows()
  if (!rows.length) return notify('当前批次还没有可导出的结果', 'error')
  if (kind === 'txt') {
    downloadFile(resultText(), 'txt', 'text/plain;charset=utf-8')
    return
  }
  if (kind === 'csv') {
    const headers = ['序号', '状态', '网盘', '账号', '原资源名称', '分享链接', '提取码', '有效期', '转存目录', '错误原因', '源链接', '任务ID']
    const body = rows.map((row) => [
      row.index, row.status, row.provider, row.account, row.name, row.url,
      row.passcode || '无', row.expiry, row.targetPath, row.error, row.sourceUrl, row.id
    ])
    const content = [headers, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n')
    downloadFile(content, 'csv', 'text/csv;charset=utf-8')
    return
  }
  const header = '| # | 状态 | 网盘 | 账号 | 原资源名称 | 分享链接 | 提取码 | 有效期 | 转存目录 | 备注 |'
  const divider = '|---:|---|---|---|---|---|---|---|---|---|'
  const body = rows.map((row) => `| ${row.index} | ${markdownCell(row.status)} | ${markdownCell(row.provider)} | ${markdownCell(row.account)} | ${markdownCell(row.name)} | ${markdownCell(row.url || '—')} | ${markdownCell(row.passcode || '无')} | ${markdownCell(row.expiry)} | ${markdownCell(row.targetPath || '—')} | ${markdownCell(row.error || '—')} |`)
  downloadFile([header, divider, ...body].join('\n'), 'md', 'text/markdown;charset=utf-8')
}

onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="transfer">
    <section class="pipeline card">
      <div v-for="(step, i) in ['识别链接', '匹配账号', '转存网盘', '生成分享']" :key="step" class="step">
        <span class="step-num mono">0{{ i + 1 }}</span>
        <strong>{{ step }}</strong>
        <span v-if="i < 3" class="step-line"><i /></span>
      </div>
    </section>

    <div class="grid">
      <section class="card input-card">
        <div class="eyebrow">PASTE &amp; PARSE</div>
        <h3 class="display">粘贴分享文案</h3>
        <p class="muted">支持整段文案,自动提取链接与提取码。可一次粘贴多个链接。</p>
        <textarea
          v-model="text"
          class="textarea paste"
          placeholder="例如：&#10;链接: https://pan.quark.cn/s/xxxxxx 提取码: 7k2x&#10;或者直接粘贴 https://pan.baidu.com/s/xxxx?pwd=abcd"
        />
        <div class="input-actions">
          <button class="btn btn-primary" :disabled="parsing" @click="parse">
            {{ parsing ? '识别中…' : '识别链接' }}
          </button>
          <button class="btn btn-ghost" @click="text = ''; links = []">清空</button>
        </div>
        <div class="samples">
          <span class="tiny muted">试一试</span>
          <button v-for="s in samples" :key="s.label" class="sample" @click="useSample(s)">{{ s.label }}</button>
        </div>
      </section>

      <section class="card result-card">
        <div class="eyebrow">TRANSFER DESK</div>
        <h3 class="display">转存设置</h3>

        <div v-if="!links.length" class="waiting">
          <div class="waiting-orb">
            <span />
            <span />
            <span />
            <b>⇄</b>
          </div>
          <p>识别后,这里会出现链接卡片和转存设置。</p>
        </div>

        <template v-else>
          <div class="link-list">
            <article v-for="(l, i) in links" :key="l.url" class="link" :style="{ '--i': i }">
              <span class="provider" :class="providerMeta[l.provider]?.cls">
                {{ providerMeta[l.provider]?.mark || '云' }}
              </span>
              <div class="link-main">
                <div class="link-top">
                  <strong>{{ providerMeta[l.provider]?.label || l.providerName }}</strong>
                  <span class="mono tiny muted">{{ l.key }}</span>
                </div>
                <div class="link-url mono">{{ l.url }}</div>
                <div class="link-code">
                  <span class="tiny muted">提取码</span>
                  <input v-model="l.passcode" class="code-input mono" placeholder="无则留空" />
                </div>
              </div>
              <button class="remove" title="移除" @click="removeLink(i)">×</button>
            </article>
          </div>

          <div class="config">
            <section class="setting-block">
              <div class="setting-title">
                <span>01</span>
                <div>
                  <strong>转存位置</strong>
                  <p>选择目标账号和文件保存目录</p>
                </div>
              </div>
              <div class="field">
                <label>目标账号</label>
                <select v-model="form.accountId" class="select">
                  <option value="">自动匹配链接对应的网盘</option>
                  <option v-for="a in matchingAccounts.length ? matchingAccounts : store.accounts" :key="a.id" :value="a.id">
                    {{ a.label }} · {{ providerMeta[a.provider]?.label || a.provider }}
                  </option>
                </select>
              </div>
              <div class="field">
                <label>转存目录</label>
                <div class="path-field">
                  <span class="path-mark">▣</span>
                  <input
                    v-model="form.targetPath"
                    class="path-input mono"
                    :placeholder="defaultTargetPath"
                    @input="targetPathTouched = true"
                    @blur="form.targetPath = form.targetPath.trim() || todayTransferPath()"
                  />
                  <button type="button" class="browse-btn" @click="openFolderPicker">浏览目录</button>
                </div>
                <span class="field-hint">
                  默认按北京时间归档到 /转存/当天日期，不存在时自动创建
                </span>
              </div>
            </section>

            <section class="setting-block">
              <div class="setting-title">
                <span>02</span>
                <div>
                  <strong>分享设置</strong>
                  <p>控制是否生成分享以及访问方式</p>
                </div>
              </div>
              <div class="toggle-row">
                <div>
                  <strong>转存后自动分享</strong>
                  <p class="muted">保留原资源名称，并立即生成新的分享链接</p>
                </div>
                <button class="switch" :class="{ on: form.autoShare }" @click="form.autoShare = !form.autoShare"><i /></button>
              </div>

              <template v-if="form.autoShare">
                <div class="two">
                  <div class="field">
                    <label>分享有效期</label>
                    <div class="expiry-control" :class="{ permanent: form.unlimited }">
                      <div class="expiry-value">
                        <template v-if="form.unlimited">
                          <b class="expiry-infinity">∞</b>
                          <span>永久有效</span>
                        </template>
                        <template v-else>
                          <input v-model.number="form.expires" class="expiry-number" type="number" min="1" max="3650" />
                          <span>天</span>
                        </template>
                      </div>
                      <button
                        type="button"
                        class="unlimited-button"
                        :class="{ active: form.unlimited }"
                        :aria-pressed="form.unlimited"
                        @click="form.unlimited = !form.unlimited"
                      >
                        <b>{{ form.unlimited ? '↺' : '∞' }}</b>
                        {{ form.unlimited ? '改回天数' : '无限' }}
                      </button>
                    </div>
                    <span class="field-hint">{{ form.unlimited ? '分享链接不会按天数自动过期' : `生成后可访问 ${form.expires || 1} 天` }}</span>
                  </div>
                  <div class="field">
                    <label>{{ hasQuarkLink ? '其他网盘提取码' : '提取码选项' }}</label>
                    <div class="passcode-options">
                      <button
                        type="button"
                        class="passcode-option"
                        :class="{ active: !form.passcodeEnabled }"
                        @click="setPasscodeEnabled(false)"
                      >
                        <b>无</b>
                        <span>直接访问</span>
                      </button>
                      <button
                        type="button"
                        class="passcode-option"
                        :class="{ active: form.passcodeEnabled }"
                        @click="setPasscodeEnabled(true)"
                      >
                        <b>4 位</b>
                        <span>提取码</span>
                      </button>
                    </div>
                    <span v-if="hasQuarkLink" class="field-hint">混合批次中夸克分享固定无提取码，此设置用于百度、迅雷等网盘</span>
                  </div>
                </div>

                <div v-if="form.passcodeEnabled" class="field passcode-detail">
                  <label>自定义提取码</label>
                  <div class="passcode-field">
                    <input
                      v-model="form.sharePasscode"
                      class="input mono"
                      maxlength="4"
                      placeholder="输入 4 位字母或数字"
                      @input="form.sharePasscode = form.sharePasscode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)"
                    />
                    <button type="button" class="generate-code" @click="randomPasscode">随机生成</button>
                  </div>
                  <span class="field-hint">
                    {{ hasQuarkLink ? '该提取码仅用于非夸克网盘；夸克分享仍可直接访问' : '分享链接将要求输入此提取码' }}
                  </span>
                </div>
                <div v-else class="no-passcode-note">
                  <span>OPEN</span>
                  {{ hasQuarkLink ? '夸克分享固定无提取码；其他网盘会按平台规则处理提取码' : '生成的分享链接不设置提取码，可直接访问' }}
                </div>
              </template>
            </section>
          </div>

          <button class="btn btn-primary go" :disabled="submitting" @click="submit">
            {{ submitting ? '正在搬运…' : `开始转存 ${links.length} 个链接 →` }}
          </button>
        </template>
      </section>
    </div>

    <section v-if="batch" ref="resultsEl" class="batch-results card">
      <div class="batch-head">
        <div>
          <div class="eyebrow">BATCH OUTPUT</div>
          <h3 class="display">转存后分享结果</h3>
          <p class="muted">生成完成后可复制为“资源名称 / 网盘名称 分享链接”，也可导出留档。</p>
        </div>
        <div class="batch-tools">
          <button class="export-btn txt" :disabled="!resultRows.length" @click="exportResult('txt')">
            <span>TXT</span>文本
          </button>
          <button class="export-btn csv" :disabled="!resultRows.length" @click="exportResult('csv')">
            <span>CSV</span>表格
          </button>
          <button class="export-btn md" :disabled="!resultRows.length" @click="exportResult('md')">
            <span>MD</span>文档
          </button>
        </div>
      </div>

      <div class="batch-status" :class="{ done: !batchRunning && pollState === 'done' }">
        <div class="batch-status-copy">
          <span class="status-orb" :class="{ live: batchRunning, error: pollState === 'error' }">
            <i />
          </span>
          <div>
            <strong>{{ batchRunning ? '正在生成本批结果' : pollState === 'error' ? '结果读取中断' : '本批次已完成' }}</strong>
            <span class="mono">BATCH {{ batch.id.slice(-8).toUpperCase() }} · {{ batchProgress }}%</span>
          </div>
        </div>
        <div class="batch-counters">
          <span><b>{{ successCount }}</b>成功</span>
          <span :class="{ warning: failedCount }"><b>{{ failedCount }}</b>失败</span>
          <span><b>{{ shareCount }}</b>分享</span>
        </div>
      </div>
      <div class="bar" :class="{ done: !batchRunning && pollState === 'done' }">
        <i :style="{ width: `${batchProgress}%` }" />
      </div>

      <div class="batch-list">
        <article
          v-for="(row, index) in resultRows"
          :key="row.id"
          class="batch-row"
          :class="row.status"
          :style="{ '--i': index }"
        >
          <div class="batch-mark" :class="providerMeta[row.provider]?.cls">
            {{ providerMeta[row.provider]?.mark || '云' }}
          </div>
          <div class="batch-row-main">
            <div class="batch-row-top">
              <div class="batch-name">
                <strong>{{ row.name }}</strong>
                <span>{{ providerLabel(row.provider) }} · {{ row.accountLabel }}</span>
              </div>
              <span class="batch-state" :class="row.status">
                <i />
                {{ statusLabel(row) }}
              </span>
            </div>

            <div v-if="row.url" class="share-output">
              <div class="share-url-wrap">
                <span class="share-label">分享链接</span>
                <a class="share-url mono" :href="row.url" target="_blank" rel="noopener noreferrer">{{ row.url }}</a>
              </div>
              <div class="share-facts">
                <button v-if="row.passcode" class="fact code" @click="copyText(row.passcode, '提取码已复制')">
                  提取码 <b class="mono">{{ row.passcode }}</b>
                </button>
                <span v-else class="fact open">无提取码</span>
                <span class="fact">{{ expiryLabel(row.expires) }}</span>
                <button class="copy-share" @click="copyText(shareCopyText(row), '分享文案已复制')">复制文案</button>
              </div>
            </div>
            <div v-else-if="row.error" class="batch-error">
              <span>!</span>
              {{ row.error }}
            </div>
            <div v-else class="batch-pending">
              <span v-if="row.status === 'queued' || row.status === 'running'">正在等待分享链接生成…</span>
              <span v-else>{{ batch.autoShare ? '任务结束，但没有返回分享链接' : '本批次未开启自动分享' }}</span>
            </div>
            <div v-if="row.targetPath" class="batch-path mono">保存至 {{ row.targetPath }}</div>
          </div>
        </article>

        <div v-if="batchRunning && batchTasks.length" class="batch-scan">
          <span />
          <p>还有 {{ batchTasks.length - completedCount }} 个链接正在转存，请保持页面打开。</p>
        </div>
      </div>

      <button class="copy-batch" :disabled="!batchCopyText()" @click="copyText(batchCopyText(), '本批分享结果已复制')">
        复制本批结果
      </button>
    </section>

    <FolderPickerModal v-model="folderPickerOpen" :account="browseAccount" @select="chooseFolder" />
  </div>
</template>

<style scoped>
.transfer { display: grid; gap: 20px; }
.pipeline { display: flex; align-items: center; padding: 16px 22px; gap: 6px; overflow: hidden; }
.step { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; }
.step-num { font-size: 9px; color: var(--coral); letter-spacing: .1em; }
.step strong { font-size: 12px; white-space: nowrap; }
.step-line { flex: 1; height: 1px; background: var(--line); position: relative; overflow: hidden; margin-left: 4px; }
.step-line i { position: absolute; inset: 0; width: 40%; background: linear-gradient(90deg, transparent, var(--coral), transparent); animation: flow 2.4s linear infinite; }
@keyframes flow { from { transform: translateX(-120%); } to { transform: translateX(320%); } }
.grid { display: grid; grid-template-columns: .92fr 1.08fr; gap: 20px; align-items: start; }
.input-card, .result-card { padding: 26px; }
.input-card h3, .result-card h3 { margin: 8px 0 6px; font-size: 28px; }
.input-card > p { margin: 0 0 16px; font-size: 12px; line-height: 1.7; }
.paste { min-height: 260px; font-size: 13px; }
.input-actions { display: flex; gap: 10px; margin-top: 14px; }
.samples { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 18px; }
.sample {
  border: 1px solid var(--line); background: rgba(255,253,248,.7); color: var(--muted);
  padding: 5px 10px; border-radius: 999px; font-size: 10px; cursor: pointer; transition: .2s;
}
.sample:hover { color: var(--coral); border-color: rgba(239,84,56,.4); background: var(--coral-soft); }
.waiting { display: grid; justify-items: center; gap: 14px; padding: 46px 10px 30px; text-align: center; }
.waiting-orb { position: relative; width: 132px; height: 132px; display: grid; place-items: center; }
.waiting-orb span { position: absolute; border-radius: 50%; border: 1px solid rgba(16,24,34,.12); }
.waiting-orb span:nth-child(1) { width: 70px; height: 70px; animation: spin-slow 9s linear infinite; }
.waiting-orb span:nth-child(2) { width: 102px; height: 102px; border-style: dashed; border-color: rgba(239,84,56,.28); animation: spin-slow 14s linear infinite reverse; }
.waiting-orb span:nth-child(3) { width: 132px; height: 132px; border-color: rgba(15,118,110,.18); animation: spin-slow 20s linear infinite; }
.waiting-orb b { font-size: 26px; color: var(--coral); font-weight: 400; }
.waiting p { max-width: 240px; margin: 0; font-size: 12px; line-height: 1.8; color: var(--muted); }
.link-list { display: grid; gap: 10px; margin: 16px 0; }
.link {
  display: flex; gap: 12px; padding: 12px; border: 1px solid var(--line-soft); border-radius: 16px;
  background: rgba(255,253,248,.62); opacity: 0; animation: reveal .5s cubic-bezier(.2,.8,.2,1) forwards;
  animation-delay: calc(var(--i) * 70ms);
}
.provider {
  width: 38px; height: 38px; flex: 0 0 auto; border-radius: 12px; display: grid; place-items: center;
  font-family: var(--display); font-size: 17px; background: var(--coral-soft); color: var(--coral);
}
.provider.teal { background: var(--teal-soft); color: var(--teal); }
.provider.blue { background: var(--blue-soft); color: var(--blue); }
.provider.gold { background: var(--gold-soft); color: var(--gold); }
.link-main { flex: 1; min-width: 0; }
.link-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.link-top strong { font-size: 13px; }
.link-url { font-size: 10px; color: var(--muted); margin: 5px 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link-code { display: flex; align-items: center; gap: 8px; }
.code-input {
  width: 110px; border: 0; border-bottom: 1px solid var(--line); background: transparent;
  font-size: 11px; padding: 3px 0; outline: none;
}
.code-input:focus { border-color: var(--coral); }
.remove { border: 0; background: transparent; color: var(--muted); font-size: 20px; cursor: pointer; align-self: flex-start; line-height: 1; }
.remove:hover { color: var(--coral); }
.config { display: grid; gap: 16px; padding-top: 4px; }
.setting-block {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--line-soft);
  border-radius: 18px;
  background: rgba(255, 253, 248, .48);
}
.setting-title { display: flex; align-items: flex-start; gap: 11px; }
.setting-title > span {
  width: 27px;
  height: 27px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--ink);
  color: #fff;
  font-family: var(--mono);
  font-size: 8px;
}
.setting-title strong { display: block; font-size: 13px; }
.setting-title p { margin: 3px 0 0; color: var(--muted); font-size: 10px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.toggle-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; border-radius: 14px; background: rgba(16,24,34,.035);
}
.toggle-row strong { font-size: 13px; }
.toggle-row p { margin: 3px 0 0; font-size: 11px; }
.path-field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 5px 5px 12px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 253, 248, .82);
  transition: border-color .2s, box-shadow .2s;
}
.path-field:focus-within {
  border-color: rgba(239, 84, 56, .55);
  box-shadow: 0 0 0 4px rgba(239, 84, 56, .1);
  background: #fffdf8;
}
.path-mark { color: var(--gold); font-size: 13px; }
.path-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  padding: 7px 0;
  font-size: 11px;
}
.browse-btn {
  flex: 0 0 auto;
  border: 0;
  border-radius: 10px;
  padding: 8px 11px;
  background: var(--gold-soft);
  color: #81550f;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: transform .2s, background .2s;
}
.browse-btn:hover { transform: translateY(-1px); background: #f3dfb9; }
.passcode-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  min-height: 47px;
}
.expiry-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 7px;
  min-height: 47px;
}
.expiry-value {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 7px 11px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 253, 248, .8);
  transition: border-color .22s, background .22s, box-shadow .22s;
}
.expiry-control.permanent .expiry-value {
  border-color: rgba(217, 154, 50, .42);
  background: linear-gradient(135deg, rgba(248, 234, 208, .9), rgba(255, 253, 248, .88));
  box-shadow: inset 0 0 0 1px rgba(217, 154, 50, .08);
}
.expiry-number {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-family: var(--mono);
  font-size: 13px;
}
.expiry-value > span {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 9px;
}
.expiry-infinity {
  color: var(--gold);
  font-family: var(--display);
  font-size: 22px;
  font-weight: 400;
  line-height: 1;
}
.unlimited-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 7px 10px;
  background: rgba(255, 253, 248, .7);
  color: var(--muted);
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;
  transition: transform .2s, color .2s, border-color .2s, background .2s, box-shadow .2s;
}
.unlimited-button b { color: var(--gold); font-size: 15px; line-height: 1; font-weight: 400; }
.unlimited-button:hover { transform: translateY(-1px); border-color: rgba(217, 154, 50, .42); color: #81550f; }
.unlimited-button.active {
  border-color: #9f6a16;
  background: linear-gradient(135deg, #d99a32, #b7791f);
  color: #fff;
  box-shadow: 0 8px 18px rgba(183, 121, 31, .24);
}
.unlimited-button.active b { color: #fff; }
.passcode-option {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 7px 8px;
  background: rgba(255, 253, 248, .7);
  color: var(--muted);
  cursor: pointer;
  transition: .2s;
}
.passcode-option b { font-size: 11px; color: var(--ink); }
.passcode-option span { font-size: 9px; }
.passcode-option:hover { border-color: rgba(15, 118, 110, .3); }
.passcode-option.active {
  border-color: rgba(15, 118, 110, .45);
  background: var(--teal-soft);
  color: var(--teal);
  box-shadow: inset 0 0 0 1px rgba(15, 118, 110, .08);
}
.passcode-option.active b { color: var(--teal); }
.passcode-detail {
  padding-top: 12px;
  border-top: 1px dashed var(--line);
  animation: reveal .3s cubic-bezier(.2,.8,.2,1) both;
}
.no-passcode-note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border-radius: 11px;
  background: rgba(16, 24, 34, .04);
  color: var(--muted);
  font-size: 10px;
}
.no-passcode-note span {
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--gold-soft);
  color: #81550f;
  font-family: var(--mono);
  font-size: 7px;
  letter-spacing: .08em;
}
.passcode-field { display: flex; gap: 8px; }
.passcode-field .input { flex: 1; min-width: 0; letter-spacing: .22em; text-transform: uppercase; }
.generate-code {
  flex: 0 0 auto; border: 1px solid var(--line); border-radius: 12px; padding: 0 13px;
  background: rgba(255,253,248,.72); color: var(--teal); font-size: 10px; font-weight: 700;
  cursor: pointer; transition: border-color .2s, background .2s;
}
.generate-code:hover { border-color: rgba(15,118,110,.35); background: var(--teal-soft); }
.field-hint { display: block; margin-top: 5px; font-size: 9px; color: var(--muted); }
.switch {
  width: 48px; height: 27px; flex: 0 0 auto; border: 0; border-radius: 999px; padding: 3px;
  background: rgba(16,24,34,.18); cursor: pointer; transition: background .24s;
}
.switch i { display: block; width: 21px; height: 21px; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0,0,0,.2); transition: transform .24s cubic-bezier(.2,.9,.2,1); }
.switch.on { background: var(--teal); }
.switch.on i { transform: translateX(21px); }
.go { width: 100%; padding: 14px; margin-top: 4px; }

.batch-results {
  padding: 26px;
  scroll-margin-top: 92px;
  overflow: visible;
  background:
    radial-gradient(520px 220px at 100% 0%, rgba(15, 118, 110, .11), transparent 64%),
    linear-gradient(180deg, rgba(255, 253, 248, .98), rgba(248, 244, 235, .94));
  animation: batch-in .58s cubic-bezier(.2,.8,.2,1) both;
}
@keyframes batch-in {
  from { opacity: 0; transform: translateY(22px) scale(.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.batch-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.batch-head h3 { margin: 7px 0 6px; font-size: 30px; }
.batch-head p { margin: 0; font-size: 12px; line-height: 1.7; }
.batch-tools { display: flex; gap: 7px; flex: 0 0 auto; }
.export-btn {
  display: flex; align-items: center; gap: 7px; border: 1px solid var(--line);
  border-radius: 13px; padding: 8px 11px; background: rgba(255,253,248,.7);
  color: var(--muted); font-size: 9px; font-weight: 700; cursor: pointer;
  transition: transform .2s, border-color .2s, background .2s, color .2s;
}
.export-btn span {
  display: grid; place-items: center; min-width: 29px; height: 24px; padding: 0 5px;
  border-radius: 7px; font-family: var(--mono); font-size: 8px; letter-spacing: .08em;
}
.export-btn.txt span { background: var(--coral-soft); color: var(--coral); }
.export-btn.csv span { background: var(--teal-soft); color: var(--teal); }
.export-btn.md span { background: var(--gold-soft); color: #8a5c14; }
.export-btn:hover { transform: translateY(-2px); border-color: rgba(16,24,34,.24); background: #fffdf8; color: var(--ink); }
.export-btn:disabled { opacity: .4; cursor: not-allowed; transform: none; }
.batch-status {
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
  margin-top: 22px; padding: 13px 15px; border: 1px solid var(--line-soft);
  border-radius: 16px; background: rgba(16,24,34,.035);
}
.batch-status.done { background: linear-gradient(100deg, rgba(15,118,110,.08), rgba(15,118,110,.02)); }
.batch-status-copy { display: flex; align-items: center; gap: 11px; min-width: 0; }
.batch-status-copy strong { display: block; font-size: 12px; }
.batch-status-copy .mono { display: block; margin-top: 3px; font-size: 8px; color: var(--muted); letter-spacing: .1em; }
.status-orb {
  width: 35px; height: 35px; display: grid; place-items: center; flex: 0 0 auto;
  border-radius: 50%; background: var(--teal-soft);
}
.status-orb i { width: 9px; height: 9px; border-radius: 50%; background: var(--teal); }
.status-orb.live { animation: pulse-ring 1.7s infinite; }
.status-orb.error { background: var(--coral-soft); }
.status-orb.error i { background: var(--coral); }
@keyframes pulse-ring {
  0%, 100% { box-shadow: 0 0 0 0 rgba(15,118,110,.2); }
  50% { box-shadow: 0 0 0 8px rgba(15,118,110,0); }
}
.batch-counters { display: flex; gap: 6px; }
.batch-counters span {
  display: flex; align-items: baseline; gap: 4px; padding: 6px 9px; border-radius: 9px;
  background: rgba(255,253,248,.7); color: var(--muted); font-size: 9px;
}
.batch-counters b { color: var(--teal); font-family: var(--mono); font-size: 13px; }
.batch-counters .warning b { color: var(--coral); }
.batch-results > .bar { margin-top: 10px; height: 5px; }
.batch-list { display: grid; gap: 10px; margin-top: 18px; }
.batch-row {
  display: flex; gap: 13px; padding: 15px; border: 1px solid var(--line-soft);
  border-radius: 17px; background: rgba(255,253,248,.72);
  box-shadow: 0 8px 28px rgba(48,34,18,.035);
  opacity: 0; animation: reveal .5s cubic-bezier(.2,.8,.2,1) forwards;
  animation-delay: calc(var(--i) * 55ms);
}
.batch-row.error { border-color: rgba(180,35,24,.13); background: rgba(253,245,242,.8); }
.batch-mark {
  width: 40px; height: 40px; flex: 0 0 auto; display: grid; place-items: center;
  border-radius: 13px; background: var(--coral-soft); color: var(--coral);
  font-family: var(--display); font-size: 18px;
}
.batch-mark.teal { background: var(--teal-soft); color: var(--teal); }
.batch-mark.blue { background: var(--blue-soft); color: var(--blue); }
.batch-mark.gold { background: var(--gold-soft); color: var(--gold); }
.batch-row-main { flex: 1; min-width: 0; }
.batch-row-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.batch-name { min-width: 0; }
.batch-name strong {
  display: block; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.batch-name > span { display: block; margin-top: 4px; color: var(--muted); font-size: 9px; }
.batch-state {
  display: flex; align-items: center; gap: 5px; flex: 0 0 auto;
  padding: 5px 8px; border-radius: 999px; background: rgba(16,24,34,.05);
  color: var(--muted); font-size: 9px; font-weight: 700;
}
.batch-state i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.batch-state.done { background: var(--teal-soft); color: var(--teal); }
.batch-state.error { background: var(--coral-soft); color: #b42318; }
.batch-state.running { background: var(--gold-soft); color: #8a5c14; }
.batch-state.running i, .batch-state.queued i { animation: pulse 1.3s infinite; }
.share-output {
  margin-top: 12px; padding: 11px 12px; border-radius: 13px;
  background: linear-gradient(100deg, rgba(15,118,110,.07), rgba(217,154,50,.05));
  border: 1px solid rgba(15,118,110,.1);
}
.share-url-wrap { display: flex; align-items: center; gap: 8px; min-width: 0; }
.share-label { flex: 0 0 auto; color: var(--teal); font-size: 9px; font-weight: 800; }
.share-url {
  min-width: 0; color: var(--ink-2); font-size: 10px; text-decoration: none;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-url:hover { color: var(--teal); text-decoration: underline; }
.share-facts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
.fact, .copy-share {
  border: 0; border-radius: 8px; padding: 4px 7px; background: rgba(255,253,248,.8);
  color: var(--muted); font-size: 8px;
}
.fact.code { cursor: pointer; background: var(--gold-soft); color: #81550f; }
.fact.code b { margin-left: 3px; letter-spacing: .12em; }
.fact.open { background: rgba(15,118,110,.08); color: var(--teal); }
.copy-share { margin-left: auto; color: var(--teal); font-weight: 700; cursor: pointer; transition: background .2s; }
.copy-share:hover { background: var(--teal-soft); }
.batch-error {
  display: flex; align-items: flex-start; gap: 7px; margin-top: 10px; padding: 9px 10px;
  border-radius: 11px; background: rgba(180,35,24,.06); color: #8d3a2e; font-size: 10px; line-height: 1.55;
}
.batch-error span {
  width: 16px; height: 16px; flex: 0 0 auto; display: grid; place-items: center;
  border-radius: 50%; background: #b42318; color: white; font-size: 9px; font-weight: 800;
}
.batch-pending {
  margin-top: 9px; padding: 8px 10px; border-radius: 10px;
  background: rgba(16,24,34,.035); color: var(--muted); font-size: 9px;
}
.batch-path { margin-top: 8px; color: var(--muted); font-size: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.batch-scan {
  position: relative; display: flex; align-items: center; justify-content: center;
  min-height: 44px; border: 1px dashed var(--line); border-radius: 14px; overflow: hidden;
}
.batch-scan span {
  position: absolute; top: 0; bottom: 0; width: 36%;
  background: linear-gradient(90deg, transparent, rgba(15,118,110,.1), transparent);
  animation: batch-scan 2.1s linear infinite;
}
@keyframes batch-scan { from { transform: translateX(-120%); } to { transform: translateX(360%); } }
.batch-scan p { position: relative; margin: 0; color: var(--muted); font-size: 9px; }
.copy-batch {
  display: flex; align-items: center; justify-content: center; margin: 16px auto 0;
  border: 1px solid var(--line); border-radius: 999px; padding: 8px 15px;
  background: rgba(255,253,248,.7); color: var(--muted); font-size: 9px; font-weight: 700;
  cursor: pointer; transition: .2s;
}
.copy-batch:hover { border-color: rgba(15,118,110,.3); background: var(--teal-soft); color: var(--teal); }
.copy-batch:disabled { opacity: .4; cursor: not-allowed; }
@media (max-width: 980px) {
  .grid { grid-template-columns: 1fr; }
  .pipeline { display: none; }
}
@media (max-width: 560px) {
  .input-card, .result-card { padding: 20px; }
  .two { grid-template-columns: 1fr; }
  .setting-block { padding: 13px; }
  .browse-btn { padding: 8px 9px; }
  .batch-results { padding: 20px 16px; }
  .batch-head { flex-direction: column; gap: 14px; }
  .batch-head h3 { font-size: 25px; }
  .batch-tools { width: 100%; }
  .export-btn { flex: 1; justify-content: center; }
  .batch-status { align-items: flex-start; flex-direction: column; gap: 10px; }
  .batch-counters { width: 100%; }
  .batch-counters span { flex: 1; justify-content: center; }
  .batch-row { padding: 12px; gap: 10px; }
  .batch-mark { width: 34px; height: 34px; border-radius: 11px; font-size: 15px; }
  .batch-row-top { flex-direction: column; gap: 8px; }
  .copy-share { margin-left: 0; }
}
</style>
