<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api.js'
import { store } from '../store.js'
import { notify } from '../toast.js'
import { fmtBytes, fmtTime } from '../format.js'
import FolderPickerModal from '../components/FolderPickerModal.vue'

const emit = defineEmits(['changed'])

const path = ref('/')
const files = ref([])
const loading = ref(false)
const busyAction = ref('')
const query = ref('')
const sortBy = ref('mtime')
const selection = ref(new Set())
const rowMenuTarget = ref(null)
const renameTarget = ref(null)
const renameName = ref('')
const folderOpen = ref(false)
const folderName = ref('')
const deleteItems = ref([])
const pickerOpen = ref(false)
const pickerMode = ref('move')
const pickerItems = ref([])
const shareOpen = ref(false)
const shareItems = ref([])
const shareBusy = ref(false)
const shareForm = ref({ expires: 7, unlimited: false, passcodeEnabled: false, passcode: '' })
const shareResult = ref(null)
const shareCopyState = ref('')
const searchMode = ref('current')
const globalResults = ref([])
const globalErrors = ref([])
const globalLoading = ref(false)
const globalQuery = ref('')
const globalProvider = ref('')
const globalMeta = ref({ accounts: 0, providers: [] })
let pendingPath = ''
let pendingSelectPath = ''
let loadSeq = 0

const account = computed(() => store.accounts.find((item) => item.id === store.activeAccountId) || null)
const providerInfo = computed(() => store.providers.find((item) => item.id === account.value?.provider) || null)
const operations = computed(() => providerInfo.value?.operations || {})
const canShare = computed(() => !!providerInfo.value?.share)
const quarkShareWithoutPasscode = computed(() => account.value?.provider === 'quark')

const providerMeta = {
  baidu: { label: '百度', cls: 'teal' },
  quark: { label: '夸克', cls: 'blue' },
  xunlei: { label: '迅雷', cls: 'gold' },
  demo: { label: '演示', cls: 'coral' }
}

const crumbs = computed(() => {
  const parts = path.value.split('/').filter(Boolean)
  if (!parts.length) return [{ label: '根目录', path: '/' }]
  const out = [{ label: '根目录', path: '/' }]
  let current = ''
  for (const part of parts) {
    current += '/' + part
    out.push({ label: part, path: current })
  }
  return out
})

const selectedItems = computed(() => files.value.filter((item) => selection.value.has(item.path)))
const visibleFiles = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  const list = keyword
    ? files.value.filter((item) => item.name.toLocaleLowerCase().includes(keyword))
    : [...files.value]
  return list.sort((a, b) => {
    if (sortBy.value === 'size') return Number(b.size || 0) - Number(a.size || 0)
    if (sortBy.value === 'mtime') return Number(b.mtime || 0) - Number(a.mtime || 0)
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  })
})
const visiblePaths = computed(() => visibleFiles.value.map((item) => item.path))
const allVisibleSelected = computed(() => visiblePaths.value.length > 0 && visiblePaths.value.every((item) => selection.value.has(item)))
const someVisibleSelected = computed(() => visiblePaths.value.some((item) => selection.value.has(item)))
const singleSelected = computed(() => selectedItems.value.length === 1 ? selectedItems.value[0] : null)
const isBusy = computed(() => !!busyAction.value)
const canRenameSelection = computed(() => !!singleSelected.value && !isBusy.value)
const canCopySelection = computed(() => selectedItems.value.length > 0 && operations.value.copy !== false && !isBusy.value)
const canMoveSelection = computed(() => selectedItems.value.length > 0 && operations.value.move !== false && !isBusy.value)
const canShareSelection = computed(() => selectedItems.value.length > 0 && canShare.value && !isBusy.value)
const canDeleteSelection = computed(() => selectedItems.value.length > 0 && !isBusy.value)
const pickerDisabledPaths = computed(() => pickerItems.value.filter((item) => item.type === 'dir').map((item) => item.path))
const pickerTitle = computed(() => pickerMode.value === 'copy' ? '复制到哪个目录' : '移动到哪个目录')
const pickerDescription = computed(() => {
  const count = pickerItems.value.length
  return `已选择 ${count} 个项目。源文件夹自身及其子目录不能作为目标目录。`
})
const shareResultTitle = computed(() => {
  if (shareItems.value.length === 1) return shareItems.value[0].name
  return `${shareItems.value.length} 个文件`
})
const shareResultText = computed(() => {
  const result = shareResult.value
  if (!result?.url) return ''
  const lines = [shareResultTitle.value, result.url]
  if (result.passcode) lines.push(`提取码：${result.passcode}`)
  return lines.join('\n')
})

const searchableProviders = computed(() => {
  const ids = [...new Set(store.accounts.map((item) => item.provider))]
  return ids.map((id) => ({
    id,
    label: providerMeta[id]?.label || store.providers.find((provider) => provider.id === id)?.name || id
  }))
})

const globalGroups = computed(() => {
  const groups = new Map()
  for (const item of globalResults.value) {
    if (!groups.has(item.accountId)) {
      groups.set(item.accountId, {
        accountId: item.accountId,
        accountLabel: item.accountLabel,
        provider: item.provider,
        providerName: item.providerName,
        items: []
      })
    }
    groups.get(item.accountId).items.push(item)
  }
  return [...groups.values()]
})

function setSelection(paths) {
  selection.value = new Set(paths)
}

function toggle(item) {
  const next = new Set(selection.value)
  if (next.has(item.path)) next.delete(item.path)
  else next.add(item.path)
  selection.value = next
}

function toggleAll() {
  if (allVisibleSelected.value) setSelection([])
  else setSelection(visiblePaths.value)
}

async function load() {
  if (!account.value) return
  const seq = ++loadSeq
  loading.value = true
  setSelection([])
  try {
    const data = await api.get(`/accounts/${account.value.id}/files?path=${encodeURIComponent(path.value)}`)
    if (seq === loadSeq) {
      files.value = Array.isArray(data) ? data : []
      if (pendingSelectPath) {
        const hit = files.value.find((item) => item.path === pendingSelectPath)
        if (hit) setSelection([hit.path])
        pendingSelectPath = ''
      }
    }
  } catch (err) {
    if (seq === loadSeq) {
      notify(err.message, 'error')
      files.value = []
    }
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function enter(item) {
  if (item.type !== 'dir') {
    toggle(item)
    return
  }
  path.value = item.path
  load()
}

function go(target) {
  path.value = target
  load()
}

function up() {
  const parts = path.value.split('/').filter(Boolean)
  parts.pop()
  path.value = '/' + parts.join('/')
  load()
}

async function runGlobalSearch() {
  const keyword = globalQuery.value.trim()
  if (!keyword) return notify('输入文件名关键词后开始全网盘检索', 'error')
  globalLoading.value = true
  try {
    const query = new URLSearchParams({ q: keyword, limit: '80' })
    if (globalProvider.value) query.set('provider', globalProvider.value)
    const data = await api.get(`/search/files?${query}`)
    globalResults.value = Array.isArray(data.items) ? data.items : []
    globalErrors.value = Array.isArray(data.errors) ? data.errors : []
    globalMeta.value = { accounts: Number(data.accounts || 0), providers: data.providers || [] }
    if (!globalResults.value.length && !globalErrors.value.length) notify('所有已连接账号中都没有找到匹配文件', 'error')
  } catch (err) {
    globalResults.value = []
    globalErrors.value = []
    notify(err.message, 'error')
  } finally {
    globalLoading.value = false
  }
}

async function openGlobalResult(item) {
  const destination = item.type === 'dir' ? item.path : (item.parentPath || '/')
  pendingPath = destination
  pendingSelectPath = item.type === 'file' ? item.path : ''
  searchMode.value = 'current'
  query.value = ''
  if (store.activeAccountId !== item.accountId) {
    store.activeAccountId = item.accountId
    return
  }
  path.value = destination
  pendingPath = ''
  await load()
}

function switchSearchMode(mode) {
  searchMode.value = mode
  if (mode === 'current') query.value = ''
}

function openRowMenu(item) {
  rowMenuTarget.value = item
}

function closeRowMenu() {
  rowMenuTarget.value = null
}

function openRename(item) {
  rowMenuTarget.value = null
  renameTarget.value = item
  renameName.value = item.name
}

function openFolder() {
  rowMenuTarget.value = null
  folderName.value = ''
  folderOpen.value = true
}

function requestDelete(items) {
  rowMenuTarget.value = null
  if (!items.length) return
  deleteItems.value = items
}

function openCopyMove(mode, items) {
  rowMenuTarget.value = null
  if (!items.length) return
  if (!operations.value[mode]) {
    return notify(`${providerInfo.value?.name || '当前网盘'}暂不支持${mode === 'copy' ? '复制' : '移动'}`, 'error')
  }
  pickerMode.value = mode
  pickerItems.value = [...items]
  pickerOpen.value = true
}

function startShare(items) {
  rowMenuTarget.value = null
  if (!canShare.value) return notify('当前网盘暂不支持分享', 'error')
  if (!items.length) return
  shareResult.value = null
  shareCopyState.value = ''
  shareItems.value = [...items]
  shareForm.value = { expires: 7, unlimited: false, passcodeEnabled: false, passcode: '' }
  shareOpen.value = true
}

function expiryLabel(expires) {
  return Number(expires) > 0 ? `${expires} 天后失效` : '永久有效'
}

function legacyCopy(text) {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) throw new Error('copy failed')
}

async function copySharePart(text, kind, label) {
  if (!text) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      legacyCopy(text)
    }
    shareCopyState.value = kind
    notify(label, 'success')
    window.setTimeout(() => {
      if (shareCopyState.value === kind) shareCopyState.value = ''
    }, 1800)
  } catch {
    notify('复制失败，请手动选择文本', 'error')
  }
}

function randomPasscode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  shareForm.value.passcode = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  shareForm.value.passcodeEnabled = true
}

async function submitRename() {
  const name = renameName.value.trim()
  if (!renameTarget.value || !name) return notify('请输入新名称', 'error')
  busyAction.value = 'rename'
  try {
    await api.post(`/accounts/${account.value.id}/files/operate`, {
      action: 'rename',
      paths: [renameTarget.value.path],
      name
    })
    renameTarget.value = null
    notify('重命名完成', 'success')
    await load()
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    busyAction.value = ''
  }
}

async function submitFolder() {
  const name = folderName.value.trim()
  if (!name) return notify('请输入文件夹名称', 'error')
  busyAction.value = 'mkdir'
  try {
    await api.post(`/accounts/${account.value.id}/files/operate`, {
      action: 'mkdir',
      destination: path.value,
      name
    })
    folderOpen.value = false
    notify('文件夹已创建', 'success')
    await load()
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    busyAction.value = ''
  }
}

async function confirmDelete() {
  if (!deleteItems.value.length) return
  busyAction.value = 'delete'
  try {
    await api.post(`/accounts/${account.value.id}/files/operate`, {
      action: 'delete',
      paths: deleteItems.value.map((item) => item.path)
    })
    const count = deleteItems.value.length
    deleteItems.value = []
    notify(`已删除 ${count} 个项目`, 'success')
    await load()
    emit('changed')
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    busyAction.value = ''
  }
}

async function chooseDestination(destination) {
  if (!pickerItems.value.length) return
  busyAction.value = pickerMode.value
  try {
    await api.post(`/accounts/${account.value.id}/files/operate`, {
      action: pickerMode.value,
      paths: pickerItems.value.map((item) => item.path),
      destination
    })
    const count = pickerItems.value.length
    pickerOpen.value = false
    notify(`${pickerMode.value === 'copy' ? '复制' : '移动'}了 ${count} 个项目`, 'success')
    await load()
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    busyAction.value = ''
  }
}

async function submitShare() {
  const form = shareForm.value
  if (!form.unlimited && (!Number.isFinite(Number(form.expires)) || Number(form.expires) < 1)) {
    return notify('请输入有效的分享天数，或选择永久有效', 'error')
  }
  if (!quarkShareWithoutPasscode.value && form.passcodeEnabled && !/^[A-Z0-9]{4}$/.test(form.passcode)) {
    return notify('请输入 4 位提取码，或选择无提取码', 'error')
  }
  shareBusy.value = true
  try {
    const data = await api.post(`/accounts/${account.value.id}/share`, {
      paths: shareItems.value.map((item) => item.path),
      unlimited: form.unlimited,
      expires: form.expires,
      passcode: quarkShareWithoutPasscode.value || !form.passcodeEnabled ? '' : form.passcode,
      title: shareItems.value.length === 1 ? shareItems.value[0].name : `${shareItems.value.length} 个文件`
    })
    shareResult.value = {
      ...data,
      generatedPasscode: account.value.provider === 'baidu' && !form.passcodeEnabled
    }
    shareOpen.value = false
    shareCopyState.value = ''
    notify('分享链接已生成', 'success')
    emit('changed')
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    shareBusy.value = false
  }
}

watch(() => store.activeAccountId, () => {
  path.value = pendingPath || '/'
  pendingPath = ''
  query.value = ''
  closeRowMenu()
  load()
})

onMounted(load)
</script>

<template>
  <div class="files">
    <div v-if="!account" class="empty card">
      <div class="empty-mark">▤</div>
      <h4 class="display">还没有可浏览的空间</h4>
      <p>连接一个网盘账号后，这里会显示其中的文件和目录。同一平台添加多个账号也能分别浏览。</p>
      <button class="btn btn-primary" @click="store.page = 'accounts'">去连接网盘</button>
    </div>

    <template v-else>
      <section class="toolbar card">
        <div class="account-chip">
          <span class="acc-mark" :class="providerMeta[account.provider]?.cls">{{ providerMeta[account.provider]?.label?.slice(0, 1) }}</span>
          <div>
            <strong>{{ account.label }}</strong>
            <span class="tiny muted">{{ providerMeta[account.provider]?.label }} · {{ account.hasCookie ? '已连接' : '未配置 Cookie' }}</span>
          </div>
        </div>
        <div class="crumbs">
          <button v-for="(crumb, index) in crumbs" :key="crumb.path" class="crumb" :class="{ active: index === crumbs.length - 1 }" @click="go(crumb.path)">
            {{ crumb.label }}
          </button>
        </div>
        <div class="tools">
          <button class="btn btn-ghost mini" :disabled="path === '/'" @click="up">↑ 上一级</button>
          <button class="btn btn-ghost mini" :disabled="loading" @click="load">刷新</button>
        </div>
      </section>

      <section class="command card">
        <div class="command-top">
          <div class="scope-switch">
            <button :class="{ active: searchMode === 'current' }" @click="switchSearchMode('current')">当前目录</button>
            <button :class="{ active: searchMode === 'global' }" @click="switchSearchMode('global')">全网盘</button>
          </div>
          <label class="search">
            <span>⌕</span>
            <input
              v-if="searchMode === 'current'"
              v-model="query"
              placeholder="筛选当前目录"
            />
            <input
              v-else
              v-model="globalQuery"
              placeholder="跨百度 / 夸克 / 迅雷检索文件名"
              @keyup.enter="runGlobalSearch"
            />
          </label>
          <button v-if="searchMode === 'global'" class="global-search-btn" :disabled="globalLoading" @click="runGlobalSearch">
            {{ globalLoading ? '检索中…' : '全网检索' }}
          </button>
          <select v-if="searchMode === 'global'" v-model="globalProvider" class="select sort-select">
            <option value="">全部网盘</option>
            <option v-for="provider in searchableProviders" :key="provider.id" :value="provider.id">{{ provider.label }}</option>
          </select>
          <select v-else v-model="sortBy" class="select sort-select">
            <option value="name">按名称排序</option>
            <option value="mtime">按修改时间 · 最新优先</option>
            <option value="size">按文件大小</option>
          </select>
          <span class="selection-count mono">
            {{ searchMode === 'global'
              ? `${globalResults.length} MATCHES`
              : selectedItems.length
                ? `SELECTED ${String(selectedItems.length).padStart(2, '0')}`
                : `${visibleFiles.length} ITEMS` }}
          </span>
        </div>

        <div v-if="searchMode === 'current'" class="command-actions">
          <button class="btn btn-ink mini" :disabled="isBusy" @click="openFolder">＋ 新建文件夹</button>
          <span class="command-divider" />
          <button class="btn btn-ghost mini" :disabled="!canRenameSelection" @click="openRename(singleSelected)">重命名</button>
          <button class="btn btn-ghost mini" :disabled="!canCopySelection" :title="operations.copy === false ? '当前网盘不支持复制' : ''" @click="openCopyMove('copy', selectedItems)">复制</button>
          <button class="btn btn-ghost mini" :disabled="!canMoveSelection" @click="openCopyMove('move', selectedItems)">移动</button>
          <button class="btn btn-ghost mini" :disabled="!canShareSelection" @click="startShare(selectedItems)">分享</button>
          <button class="btn btn-quiet mini danger" :disabled="!canDeleteSelection" @click="requestDelete(selectedItems)">删除</button>
          <button v-if="selectedItems.length" class="clear-selection" @click="setSelection([])">取消选择</button>
        </div>
      </section>

      <section v-if="searchMode === 'current'" class="list card">
        <div class="list-head">
          <label class="check-wrap" title="全选当前列表">
            <input type="checkbox" :checked="allVisibleSelected" :indeterminate="someVisibleSelected && !allVisibleSelected" @change="toggleAll" />
            <span />
          </label>
          <span class="head-name">名称</span>
          <span class="head-size">大小</span>
          <span class="head-time">修改时间</span>
          <span class="head-actions">操作</span>
        </div>

        <div v-if="loading" class="loading">
          <span class="loading-ring" />
          正在读取目录…
        </div>
        <div v-else-if="!visibleFiles.length" class="empty-soft">
          <span class="empty-folder">{{ query ? '⌕' : '▣' }}</span>
          <strong>{{ query ? '没有匹配的文件' : '这个目录是空的' }}</strong>
          <small>{{ query ? '换个关键词试试' : '点击上方「新建文件夹」开始整理空间' }}</small>
        </div>

        <template v-else>
          <article
            v-for="(item, index) in visibleFiles"
            :key="item.path"
            class="row"
            :class="{ selected: selection.has(item.path) }"
            :style="{ '--i': index }"
            @dblclick="enter(item)"
          >
            <label class="check-wrap" @click.stop>
              <input type="checkbox" :checked="selection.has(item.path)" @change="toggle(item)" />
              <span />
            </label>
            <button class="row-main" @click="enter(item)">
              <span class="file-icon" :class="{ dir: item.type === 'dir' }">{{ item.type === 'dir' ? '▣' : '▤' }}</span>
              <span class="name-wrap">
                <strong class="file-name">{{ item.name }}</strong>
                <small class="mono">{{ item.type === 'dir' ? 'FOLDER' : 'FILE' }}</small>
              </span>
            </button>
            <span class="file-size mono">{{ item.type === 'file' ? fmtBytes(item.size) : '—' }}</span>
            <span class="file-time mono">{{ fmtTime(item.mtime) }}</span>
            <div class="row-actions">
              <button class="icon-btn share-btn" :disabled="!canShare" title="分享" @click.stop="startShare([item])">↗</button>
              <button class="icon-btn" title="更多操作" @click.stop="openRowMenu(item)">•••</button>
            </div>
          </article>
        </template>
      </section>

      <section v-else class="global-panel card">
        <div v-if="globalLoading" class="global-loading">
          <span class="radar">
            <i />
            <i />
            <i />
            <b>⌕</b>
          </span>
          <strong>正在穿过三朵云…</strong>
          <small>并行检索 {{ searchableProviders.map((provider) => provider.label).join(' / ') }}</small>
        </div>
        <div v-else-if="!globalQuery.trim()" class="global-intro">
          <span class="global-glyph">⌕</span>
          <h4 class="display">一次搜索，翻遍所有网盘</h4>
          <p>输入文件名关键词，系统只会在你自己的账号中检索。点击结果即可切换到对应账号并打开所在目录。</p>
          <div class="provider-pills">
            <span v-for="provider in searchableProviders" :key="provider.id" :class="providerMeta[provider.id]?.cls">
              {{ provider.label }}
            </span>
          </div>
        </div>
        <template v-else>
          <div class="global-summary">
            <div>
              <span class="mono">GLOBAL SEARCH</span>
              <strong>“{{ globalQuery }}”</strong>
            </div>
            <p>{{ globalResults.length }} 个结果 · 已检索 {{ globalMeta.accounts }} 个账号</p>
          </div>
          <div v-if="globalErrors.length" class="global-errors">
            <span v-for="error in globalErrors" :key="error.accountId">
              <b>{{ error.accountLabel }}</b>{{ error.error }}
            </span>
          </div>
          <div v-if="!globalResults.length" class="empty-soft">
            <span class="empty-folder">⌕</span>
            <strong>没有找到匹配文件</strong>
            <small>试试更短的关键词，或切换到全部网盘</small>
          </div>
          <div v-else class="global-groups">
            <section v-for="(group, groupIndex) in globalGroups" :key="group.accountId" class="global-group" :style="{ '--g': groupIndex }">
              <header>
                <span class="acc-mark" :class="providerMeta[group.provider]?.cls">{{ providerMeta[group.provider]?.label?.slice(0, 1) }}</span>
                <div>
                  <strong>{{ group.accountLabel }}</strong>
                  <small>{{ group.providerName }} · {{ group.items.length }} 个结果</small>
                </div>
                <span class="group-line" />
              </header>
              <article
                v-for="item in group.items"
                :key="`${item.accountId}:${item.path}`"
                class="global-row"
                @click="openGlobalResult(item)"
              >
                <span class="file-icon" :class="{ dir: item.type === 'dir' }">{{ item.type === 'dir' ? '▣' : '▤' }}</span>
                <div class="global-row-main">
                  <strong>{{ item.name }}</strong>
                  <span class="mono">{{ item.parentPath || '/' }}</span>
                </div>
                <span class="global-size mono">{{ item.type === 'file' ? fmtBytes(item.size) : '文件夹' }}</span>
                <span class="global-time mono">{{ fmtTime(item.mtime) }}</span>
                <span class="global-open">打开 →</span>
              </article>
            </section>
          </div>
        </template>
      </section>
    </template>

    <FolderPickerModal
      v-model="pickerOpen"
      :account="account"
      :title="pickerTitle"
      eyebrow="CHOOSE DESTINATION"
      :description="pickerDescription"
      :confirm-text="pickerMode === 'copy' ? '复制到此目录' : '移动到此目录'"
      :disabled-paths="pickerDisabledPaths"
      @select="chooseDestination"
    />

    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="rowMenuTarget" class="backdrop" @click.self="closeRowMenu">
          <div class="dialog row-dialog">
            <div class="dialog-head">
              <div class="target-title">
                <span class="file-icon" :class="{ dir: rowMenuTarget.type === 'dir' }">{{ rowMenuTarget.type === 'dir' ? '▣' : '▤' }}</span>
                <div>
                  <div class="tiny muted">FILE ACTIONS</div>
                  <h3 class="display">{{ rowMenuTarget.name }}</h3>
                </div>
              </div>
              <button class="close" @click="closeRowMenu">×</button>
            </div>
            <div class="action-grid">
              <button @click="openRename(rowMenuTarget)"><b>✎</b><span>重命名</span></button>
              <button @click="startShare([rowMenuTarget])" :disabled="!canShare"><b>↗</b><span>分享</span></button>
              <button @click="openCopyMove('copy', [rowMenuTarget])" :disabled="!operations.copy"><b>⧉</b><span>复制</span></button>
              <button @click="openCopyMove('move', [rowMenuTarget])" :disabled="!operations.move"><b>→</b><span>移动</span></button>
              <button class="danger" @click="requestDelete([rowMenuTarget])"><b>×</b><span>删除</span></button>
            </div>
            <p v-if="!operations.copy" class="hint">当前网盘不支持复制，其它操作不受影响。</p>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="renameTarget" class="backdrop" @click.self="renameTarget = null">
          <div class="dialog">
            <div class="dialog-head">
              <div>
                <div class="tiny muted">RENAME</div>
                <h3 class="display">重命名</h3>
              </div>
              <button class="close" @click="renameTarget = null">×</button>
            </div>
            <p class="dialog-copy">为「{{ renameTarget.name }}」换一个更清晰的名字。</p>
            <div class="field">
              <label>新名称</label>
              <input v-model="renameName" class="input" maxlength="180" @keyup.enter="submitRename" />
            </div>
            <div class="dialog-actions">
              <button class="btn btn-ghost" @click="renameTarget = null">取消</button>
              <button class="btn btn-primary" :disabled="busyAction === 'rename'" @click="submitRename">{{ busyAction === 'rename' ? '保存中…' : '确认重命名' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="folderOpen" class="backdrop" @click.self="folderOpen = false">
          <div class="dialog">
            <div class="dialog-head">
              <div>
                <div class="tiny muted">NEW FOLDER</div>
                <h3 class="display">新建文件夹</h3>
              </div>
              <button class="close" @click="folderOpen = false">×</button>
            </div>
            <div class="current-path">
              <span class="tiny muted">创建位置</span>
              <strong class="mono">{{ path }}</strong>
            </div>
            <div class="field">
              <label>文件夹名称</label>
              <input v-model="folderName" class="input" maxlength="180" placeholder="例如：我的收藏" @keyup.enter="submitFolder" />
            </div>
            <div class="dialog-actions">
              <button class="btn btn-ghost" @click="folderOpen = false">取消</button>
              <button class="btn btn-primary" :disabled="busyAction === 'mkdir'" @click="submitFolder">{{ busyAction === 'mkdir' ? '创建中…' : '创建文件夹' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="deleteItems.length" class="backdrop" @click.self="deleteItems = []">
          <div class="dialog danger-dialog">
            <div class="dialog-head">
              <div>
                <div class="tiny muted">DELETE</div>
                <h3 class="display">确认删除 {{ deleteItems.length }} 个项目？</h3>
              </div>
              <button class="close" @click="deleteItems = []">×</button>
            </div>
            <div class="delete-list">
              <span v-for="item in deleteItems.slice(0, 6)" :key="item.path">{{ item.name }}</span>
              <small v-if="deleteItems.length > 6">另有 {{ deleteItems.length - 6 }} 个项目</small>
            </div>
            <p class="danger-note">此操作会直接删除网盘中的文件或文件夹，请确认不再需要它们。</p>
            <div class="dialog-actions">
              <button class="btn btn-ghost" @click="deleteItems = []">取消</button>
              <button class="btn btn-danger" :disabled="busyAction === 'delete'" @click="confirmDelete">{{ busyAction === 'delete' ? '删除中…' : '确认删除' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="share-reveal">
        <div v-if="shareResult" class="backdrop share-result-backdrop" @click.self="shareResult = null">
          <div class="dialog share-result-dialog">
            <div class="share-success-mark" aria-hidden="true">
              <span class="orbit orbit-a" />
              <span class="orbit orbit-b" />
              <b>✓</b>
            </div>
            <div class="share-result-head">
              <div>
                <div class="tiny muted">SHARE READY</div>
                <h3 class="display">分享已经准备好</h3>
                <p>{{ shareResultTitle }}</p>
              </div>
              <button class="close" aria-label="关闭" @click="shareResult = null">×</button>
            </div>

            <div class="result-card">
              <div class="result-row">
                <span class="result-label">分享链接</span>
                <div class="result-value">
                  <input
                    class="result-input mono"
                    :value="shareResult.url"
                    readonly
                    aria-label="分享链接"
                    @focus="$event.target.select()"
                  />
                  <button
                    class="result-copy"
                    :class="{ copied: shareCopyState === 'url' }"
                    @click="copySharePart(shareResult.url, 'url', '分享链接已复制')"
                  >
                    {{ shareCopyState === 'url' ? '已复制' : '复制链接' }}
                  </button>
                </div>
              </div>

              <div class="result-row">
                <span class="result-label">提取码</span>
                <div class="result-value">
                  <strong v-if="shareResult.passcode" class="result-passcode mono">{{ shareResult.passcode }}</strong>
                  <span v-else class="result-empty">此分享没有提取码</span>
                  <button
                    v-if="shareResult.passcode"
                    class="result-copy code-copy"
                    :class="{ copied: shareCopyState === 'code' }"
                    @click="copySharePart(shareResult.passcode, 'code', '提取码已复制')"
                  >
                    {{ shareCopyState === 'code' ? '已复制' : '复制提取码' }}
                  </button>
                </div>
              </div>

              <div class="result-meta">
                <span>{{ expiryLabel(shareResult.expires) }}</span>
                <span v-if="shareResult.generatedPasscode">百度已自动生成 4 位提取码</span>
              </div>
            </div>

            <button
              class="copy-all"
              :class="{ copied: shareCopyState === 'all' }"
              @click="copySharePart(shareResultText, 'all', '完整分享文案已复制')"
            >
              <span>{{ shareCopyState === 'all' ? '✓' : '⧉' }}</span>
              <div>
                <strong>{{ shareCopyState === 'all' ? '完整分享文案已复制' : '复制完整分享文案' }}</strong>
                <small>文件名、链接与提取码会一起复制</small>
              </div>
            </button>

            <div class="dialog-actions share-result-actions">
              <button class="btn btn-ghost" @click="shareResult = null">完成</button>
              <a class="btn btn-primary" :href="shareResult.url" target="_blank" rel="noopener noreferrer">打开分享</a>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="dialog">
        <div v-if="shareOpen" class="backdrop" @click.self="shareOpen = false">
          <div class="dialog share-dialog">
            <div class="dialog-head">
              <div>
                <div class="tiny muted">CREATE SHARE</div>
                <h3 class="display">创建分享</h3>
              </div>
              <button class="close" @click="shareOpen = false">×</button>
            </div>
            <div class="share-targets">
              <span v-for="item in shareItems.slice(0, 4)" :key="item.path">{{ item.name }}</span>
              <small v-if="shareItems.length > 4">+{{ shareItems.length - 4 }}</small>
            </div>
            <div class="share-options">
              <div class="field">
                <label>分享有效期</label>
                <div class="expiry-control" :class="{ permanent: shareForm.unlimited }">
                  <div class="expiry-value">
                    <template v-if="shareForm.unlimited">
                      <b class="expiry-infinity">∞</b>
                      <span>永久有效</span>
                    </template>
                    <template v-else>
                      <input v-model.number="shareForm.expires" class="expiry-number" type="number" min="1" max="3650" />
                      <span>天</span>
                    </template>
                  </div>
                  <button
                    type="button"
                    class="unlimited-button"
                    :class="{ active: shareForm.unlimited }"
                    :aria-pressed="shareForm.unlimited"
                    @click="shareForm.unlimited = !shareForm.unlimited"
                  >
                    <b>{{ shareForm.unlimited ? '↺' : '∞' }}</b>
                    {{ shareForm.unlimited ? '改回天数' : '无限' }}
                  </button>
                </div>
              </div>
              <div class="field">
                <label>提取码</label>
                <div v-if="quarkShareWithoutPasscode" class="hint">夸克分享固定无提取码，可直接访问</div>
                <div v-else class="passcode-switch">
                  <button :class="{ active: !shareForm.passcodeEnabled }" @click="shareForm.passcodeEnabled = false">无提取码</button>
                  <button :class="{ active: shareForm.passcodeEnabled }" @click="shareForm.passcodeEnabled = true">4 位提取码</button>
                </div>
              </div>
            </div>
            <div v-if="!quarkShareWithoutPasscode && shareForm.passcodeEnabled" class="passcode-field">
              <input
                v-model="shareForm.passcode"
                class="input mono"
                maxlength="4"
                placeholder="输入 4 位字母或数字"
                @input="shareForm.passcode = shareForm.passcode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)"
              />
              <button class="btn btn-ghost mini" @click="randomPasscode">随机生成</button>
            </div>
            <p class="hint">资源名称将保持原样；分享生成后会同步记录到「分享库」。</p>
            <div class="dialog-actions">
              <button class="btn btn-ghost" @click="shareOpen = false">取消</button>
              <button class="btn btn-primary" :disabled="shareBusy" @click="submitShare">{{ shareBusy ? '生成中…' : '生成分享链接' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.files { display: grid; gap: 16px; }
.toolbar { display: flex; align-items: center; gap: 18px; padding: 12px 16px; flex-wrap: wrap; z-index: 3; }
.account-chip { display: flex; align-items: center; gap: 10px; }
.acc-mark {
  width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center;
  background: var(--coral-soft); color: var(--coral); font-family: var(--display); font-size: 16px;
}
.acc-mark.teal { background: var(--teal-soft); color: var(--teal); }
.acc-mark.blue { background: var(--blue-soft); color: var(--blue); }
.acc-mark.gold { background: var(--gold-soft); color: var(--gold); }
.account-chip > div { display: grid; gap: 2px; min-width: 0; }
.account-chip strong { font-size: 12px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-chip span { font-size: 9px; }
.crumbs { display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0; overflow-x: auto; }
.crumb {
  border: 0; background: transparent; color: var(--muted); font-size: 11px; cursor: pointer;
  padding: 5px 7px; border-radius: 8px; white-space: nowrap;
}
.crumb::after { content: "/"; margin-left: 7px; opacity: .3; }
.crumb:last-child::after { content: ""; }
.crumb:hover { background: rgba(16,24,34,.05); color: var(--ink); }
.crumb.active { color: var(--ink); font-weight: 700; }
.tools { display: flex; gap: 6px; }
.mini { padding: 6px 10px; font-size: 10px; }

.command { padding: 12px 14px; z-index: 2; }
.command-top { display: flex; align-items: center; gap: 9px; }
.scope-switch {
  display: flex; flex: 0 0 auto; gap: 2px; padding: 3px;
  border-radius: 11px; background: var(--ink-soft);
}
.scope-switch button {
  border: 0; border-radius: 8px; padding: 6px 9px; background: transparent;
  color: var(--muted); font-size: 9px; font-weight: 700; cursor: pointer; transition: .2s;
}
.scope-switch button.active { background: var(--field-strong); color: var(--ink); box-shadow: 0 3px 10px rgba(16,24,34,.08); }
.search {
  display: flex; align-items: center; gap: 7px; flex: 1; min-width: 160px;
  padding: 7px 11px; border: 1px solid var(--line-soft); border-radius: 11px;
  background: rgba(255,253,248,.65); color: var(--muted);
  transition: border-color .2s, box-shadow .2s;
}
.search:focus-within { border-color: rgba(15,118,110,.32); box-shadow: 0 0 0 3px rgba(15,118,110,.07); }
.search span { font-size: 17px; line-height: 1; }
.search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 11px; }
.global-search-btn {
  flex: 0 0 auto; border: 0; border-radius: 10px; padding: 8px 12px;
  background: linear-gradient(135deg, var(--teal), #36a297); color: #fff;
  box-shadow: 0 7px 16px rgba(15,118,110,.2); font-size: 9px; font-weight: 800; cursor: pointer;
  transition: transform .2s, box-shadow .2s;
}
.global-search-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 20px rgba(15,118,110,.25); }
.global-search-btn:disabled { opacity: .55; cursor: wait; transform: none; }
.sort-select { width: 135px; padding: 7px 10px; border-radius: 11px; font-size: 10px; }
.selection-count { flex: 0 0 auto; color: rgba(16,24,34,.34); font-size: 8px; letter-spacing: .13em; }
.command-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line-soft); }
.command-divider { width: 1px; height: 20px; margin: 0 4px; background: var(--line-soft); }
.clear-selection { margin-left: auto; border: 0; background: transparent; color: var(--muted); font-size: 9px; cursor: pointer; padding: 5px 7px; }
.clear-selection:hover { color: var(--coral); }

.list { padding: 8px; min-height: 260px; }
.list-head {
  display: grid; grid-template-columns: 28px minmax(0, 1fr) 100px 140px 76px;
  align-items: center; gap: 10px; padding: 7px 12px 9px; color: rgba(16,24,34,.38);
  font-size: 8px; letter-spacing: .12em; text-transform: uppercase;
}
.head-size, .head-time, .head-actions { text-align: left; }
.head-actions { text-align: center; }
.row {
  display: grid; grid-template-columns: 28px minmax(0, 1fr) 100px 140px 76px; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 13px; border: 1px solid transparent;
  transition: background .18s, border-color .18s, transform .18s;
  opacity: 0; animation: reveal .42s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: calc(var(--i) * 28ms);
}
.row:hover { background: rgba(16,24,34,.035); transform: translateX(2px); }
.row.selected { background: rgba(15,118,110,.065); border-color: rgba(15,118,110,.13); }
.check-wrap { width: 22px; height: 22px; display: grid; place-items: center; cursor: pointer; }
.check-wrap input { position: absolute; opacity: 0; pointer-events: none; }
.check-wrap span {
  width: 16px; height: 16px; border: 1.5px solid rgba(16,24,34,.2); border-radius: 5px;
  background: rgba(255,253,248,.7); transition: background .18s, border-color .18s, transform .18s;
}
.check-wrap input:checked + span { background: var(--teal); border-color: var(--teal); transform: rotate(-4deg); }
.check-wrap input:checked + span::after { content: "✓"; display: block; margin-top: -4px; color: #fff; font-size: 12px; text-align: center; }
.check-wrap input:indeterminate + span { background: var(--gold); border-color: var(--gold); }
.row-main { display: flex; align-items: center; gap: 10px; border: 0; background: transparent; cursor: pointer; text-align: left; min-width: 0; }
.file-icon {
  width: 34px; height: 34px; flex: 0 0 auto; border-radius: 10px; display: grid; place-items: center;
  background: var(--blue-soft); color: var(--blue); font-size: 14px;
}
.file-icon.dir { background: var(--gold-soft); color: var(--gold); }
.name-wrap { display: grid; gap: 2px; min-width: 0; }
.file-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name-wrap small { font-size: 7px; color: rgba(16,24,34,.3); letter-spacing: .1em; }
.file-size, .file-time { font-size: 9px; color: var(--muted); }
.row-actions { display: flex; justify-content: flex-end; gap: 3px; }
.icon-btn {
  width: 29px; height: 29px; display: grid; place-items: center; border: 0; border-radius: 9px;
  background: transparent; color: var(--muted); font-size: 12px; cursor: pointer; transition: .18s;
}
.icon-btn:hover { color: var(--ink); background: rgba(16,24,34,.06); }
.share-btn { color: var(--teal); }
.icon-btn:disabled { opacity: .25; cursor: not-allowed; }
.loading, .empty-soft { min-height: 220px; display: grid; place-items: center; align-content: center; gap: 9px; padding: 40px; text-align: center; color: var(--muted); font-size: 12px; }
.loading-ring { width: 25px; height: 25px; border: 2px solid rgba(15,118,110,.18); border-top-color: var(--teal); border-radius: 50%; animation: spin-slow 1s linear infinite; }
.empty-folder { font-size: 38px; color: rgba(16,24,34,.14); }
.empty-soft strong { font-size: 13px; color: var(--ink-2); }
.empty-soft small { font-size: 10px; }
.empty { display: grid; justify-items: center; gap: 9px; padding: 56px 20px; text-align: center; }
.empty-mark { font-size: 42px; color: rgba(16,24,34,.16); }
.empty h4 { margin: 0; font-size: 25px; }
.empty p { max-width: 430px; margin: 0 0 8px; font-size: 13px; line-height: 1.7; color: var(--muted); }
.danger { color: #b42318; }
.btn-danger { color: #fff; background: linear-gradient(135deg, #b42318, var(--coral)); box-shadow: 0 12px 28px rgba(180,35,24,.2); }

.global-panel {
  min-height: 380px; padding: 20px;
  background:
    radial-gradient(520px 260px at 100% 0%, var(--glow-b), transparent 64%),
    linear-gradient(180deg, var(--card-a), var(--card-b));
}
.global-intro, .global-loading {
  min-height: 330px; display: grid; justify-items: center; align-content: center;
  gap: 12px; text-align: center;
}
.global-glyph {
  width: 76px; height: 76px; display: grid; place-items: center; border-radius: 26px;
  background: var(--teal-soft); color: var(--teal); font-family: var(--display); font-size: 36px;
  box-shadow: inset 0 0 0 1px rgba(15,118,110,.08);
}
.global-intro h4 { margin: 2px 0 0; font-size: 26px; }
.global-intro p { max-width: 490px; margin: 0; color: var(--muted); font-size: 11px; line-height: 1.75; }
.provider-pills { display: flex; gap: 7px; margin-top: 5px; flex-wrap: wrap; justify-content: center; }
.provider-pills span { padding: 5px 10px; border-radius: 999px; background: var(--coral-soft); color: var(--coral); font-size: 9px; font-weight: 700; }
.provider-pills span.teal { background: var(--teal-soft); color: var(--teal); }
.provider-pills span.blue { background: var(--blue-soft); color: var(--blue); }
.provider-pills span.gold { background: var(--gold-soft); color: #8a5c14; }
.global-loading strong { font-family: var(--display); font-size: 22px; }
.global-loading small { color: var(--muted); font-size: 9px; }
.radar { position: relative; width: 92px; height: 92px; display: grid; place-items: center; }
.radar i { position: absolute; border: 1px solid rgba(15,118,110,.2); border-radius: 50%; }
.radar i:nth-child(1) { width: 44px; height: 44px; animation: spin-slow 8s linear infinite; border-style: dashed; }
.radar i:nth-child(2) { width: 68px; height: 68px; animation: spin-slow 12s linear infinite reverse; }
.radar i:nth-child(3) { width: 92px; height: 92px; border-color: rgba(217,154,50,.24); animation: pulse-ring 2.2s infinite; }
.radar b { color: var(--teal); font-size: 25px; font-weight: 400; }
.global-summary {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
  padding: 4px 2px 16px; border-bottom: 1px solid var(--line-soft);
}
.global-summary > div { display: grid; gap: 4px; }
.global-summary span { color: var(--muted); font-size: 7px; letter-spacing: .17em; }
.global-summary strong { font-family: var(--display); font-size: 21px; font-weight: 500; }
.global-summary p { margin: 0; color: var(--muted); font-size: 9px; }
.global-errors { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.global-errors span {
  padding: 6px 9px; border-radius: 9px; background: var(--coral-soft); color: #8d3a2e;
  font-size: 9px; line-height: 1.5;
}
.global-errors b { margin-right: 5px; }
.global-groups { display: grid; gap: 18px; margin-top: 15px; }
.global-group {
  opacity: 0; animation: reveal .5s cubic-bezier(.2,.8,.2,1) forwards;
  animation-delay: calc(var(--g) * 80ms);
}
.global-group > header { display: flex; align-items: center; gap: 9px; padding: 2px 4px 9px; }
.global-group > header > div { display: grid; gap: 2px; }
.global-group > header strong { font-size: 11px; }
.global-group > header small { color: var(--muted); font-size: 8px; }
.group-line { height: 1px; flex: 1; background: var(--line-soft); }
.global-row {
  display: grid; grid-template-columns: 34px minmax(0, 1fr) 88px 120px 58px;
  align-items: center; gap: 10px; padding: 9px 10px; border-radius: 12px;
  border: 1px solid transparent; cursor: pointer; transition: background .18s, border-color .18s, transform .18s;
}
.global-row:hover { background: var(--ink-soft); border-color: var(--line-soft); transform: translateX(2px); }
.global-row-main { display: grid; gap: 3px; min-width: 0; }
.global-row-main strong { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.global-row-main span { color: var(--muted); font-size: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.global-size, .global-time { color: var(--muted); font-size: 8px; }
.global-open { color: var(--teal); font-size: 8px; font-weight: 800; text-align: right; opacity: 0; transform: translateX(-4px); transition: .18s; }
.global-row:hover .global-open { opacity: 1; transform: translateX(0); }

.backdrop {
  position: fixed; inset: 0; z-index: 240; display: grid; place-items: center; padding: 20px;
  background: rgba(16, 24, 34, .5); backdrop-filter: blur(12px);
}
.dialog {
  width: min(500px, 100%); max-height: min(760px, calc(100vh - 40px)); overflow-y: auto;
  display: grid; gap: 15px; padding: 24px; border: 1px solid rgba(255,255,255,.35);
  border-radius: 25px; background: linear-gradient(180deg, #fffdf8, #f6f0e5);
  box-shadow: 0 40px 100px rgba(16, 24, 34, .36);
}
.row-dialog { width: min(540px, 100%); }
.dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; }
.dialog-head h3 { margin: 4px 0 0; font-size: 25px; line-height: 1.25; overflow-wrap: anywhere; }
.close { border: 0; background: transparent; color: var(--muted); font-size: 27px; line-height: 1; padding: 0 3px; cursor: pointer; }
.close:hover { color: var(--coral); }
.dialog-copy { margin: -2px 0 0; color: var(--muted); font-size: 11px; line-height: 1.7; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 2px; }
.target-title { display: flex; align-items: center; gap: 11px; min-width: 0; }
.target-title > div { min-width: 0; }
.action-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.action-grid button {
  display: grid; justify-items: center; gap: 7px; padding: 14px 6px;
  border: 1px solid var(--line-soft); border-radius: 14px; background: rgba(255,253,248,.55);
  color: var(--ink); cursor: pointer; transition: transform .2s, background .2s, border-color .2s;
}
.action-grid button:hover { transform: translateY(-2px); background: #fffdf8; border-color: rgba(16,24,34,.18); }
.action-grid button:disabled { opacity: .35; cursor: not-allowed; transform: none; }
.action-grid button b { font-size: 18px; font-weight: 400; }
.action-grid button span { font-size: 10px; font-weight: 700; }
.action-grid button.danger { color: #b42318; }
.hint { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.6; }
.current-path { display: grid; gap: 5px; padding: 11px 13px; border-radius: 13px; background: var(--teal-soft); }
.current-path strong { color: var(--teal); font-size: 11px; overflow-wrap: anywhere; }
.delete-list {
  display: flex; flex-wrap: wrap; gap: 6px; padding: 12px; border-radius: 13px;
  background: rgba(180,35,24,.055); border: 1px solid rgba(180,35,24,.1);
}
.delete-list span, .delete-list small {
  padding: 5px 8px; border-radius: 7px; background: rgba(255,253,248,.72);
  color: #7d2a20; font-size: 10px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.danger-note { margin: 0; color: #8d3a2e; font-size: 10px; line-height: 1.65; }
.share-targets { display: flex; flex-wrap: wrap; gap: 6px; }
.share-targets span, .share-targets small {
  padding: 5px 8px; border-radius: 8px; background: var(--blue-soft); color: #33456b;
  font-size: 10px; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-options { display: grid; grid-template-columns: 1fr 1.2fr; gap: 11px; }
.expiry-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  min-height: 43px;
}
.expiry-value {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 11px;
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
  font-size: 12px;
}
.expiry-value > span {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 9px;
}
.expiry-infinity {
  color: var(--gold);
  font-family: var(--display);
  font-size: 21px;
  font-weight: 400;
  line-height: 1;
}
.unlimited-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 1px solid var(--line);
  border-radius: 11px;
  padding: 7px 9px;
  background: rgba(255, 253, 248, .7);
  color: var(--muted);
  font-size: 8px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: transform .2s, color .2s, border-color .2s, background .2s, box-shadow .2s;
}
.unlimited-button b { color: var(--gold); font-size: 14px; line-height: 1; font-weight: 400; }
.unlimited-button:hover { transform: translateY(-1px); border-color: rgba(217, 154, 50, .42); color: #81550f; }
.unlimited-button.active {
  border-color: #9f6a16;
  background: linear-gradient(135deg, #d99a32, #b7791f);
  color: #fff;
  box-shadow: 0 8px 18px rgba(183, 121, 31, .24);
}
.unlimited-button.active b { color: #fff; }
.passcode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.passcode-switch button {
  border: 1px solid var(--line); border-radius: 11px; padding: 10px 6px; background: rgba(255,253,248,.62);
  color: var(--muted); font-size: 9px; font-weight: 700; cursor: pointer; transition: .2s;
}
.passcode-switch button.active { border-color: rgba(15,118,110,.4); background: var(--teal-soft); color: var(--teal); }
.passcode-field { display: flex; gap: 7px; }
.passcode-field .input { flex: 1; min-width: 0; letter-spacing: .2em; }

.share-result-backdrop { z-index: 260; }
.share-result-dialog {
  width: min(530px, 100%);
  gap: 17px;
  overflow: hidden;
  background:
    radial-gradient(360px 220px at 92% -12%, rgba(217, 154, 50, .18), transparent 68%),
    linear-gradient(155deg, #fffdf8, #f4eddf);
}
.share-success-mark {
  position: relative;
  width: 68px;
  height: 68px;
  display: grid;
  place-items: center;
  margin: 1px auto -1px;
}
.share-success-mark b {
  position: relative;
  z-index: 2;
  width: 45px;
  height: 45px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(145deg, #14887e, #0b665f);
  color: #fff;
  font-size: 20px;
  font-weight: 500;
  box-shadow: 0 13px 28px rgba(15, 118, 110, .27);
  animation: success-pop .55s cubic-bezier(.2, 1.35, .4, 1) both;
}
.orbit {
  position: absolute;
  inset: 4px;
  border: 1px solid rgba(15, 118, 110, .22);
  border-radius: 50%;
}
.orbit-a { animation: orbit-pulse 2.8s ease-out infinite; }
.orbit-b { inset: 0; border-style: dashed; border-color: rgba(217, 154, 50, .36); animation: spin-slow 12s linear infinite; }
.share-result-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; text-align: center; }
.share-result-head > div { flex: 1; min-width: 0; }
.share-result-head h3 { margin: 5px 0 5px; font-size: 28px; letter-spacing: -.03em; }
.share-result-head p {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.share-result-head .close { flex: 0 0 auto; }
.result-card {
  display: grid;
  gap: 0;
  padding: 4px 16px;
  overflow: hidden;
  border: 1px solid rgba(16, 24, 34, .09);
  border-radius: 18px;
  background: rgba(255, 253, 248, .72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .65);
}
.result-row { display: grid; gap: 7px; padding: 13px 0; }
.result-row + .result-row { border-top: 1px dashed var(--line); }
.result-label { color: var(--muted); font-size: 8px; font-weight: 800; letter-spacing: .12em; }
.result-value { display: flex; align-items: center; gap: 9px; min-width: 0; }
.result-input {
  flex: 1;
  min-width: 0;
  padding: 3px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: 10px;
}
.result-copy {
  flex: 0 0 auto;
  border: 1px solid rgba(15, 118, 110, .2);
  border-radius: 9px;
  padding: 7px 10px;
  background: var(--teal-soft);
  color: var(--teal);
  font-size: 9px;
  font-weight: 800;
  cursor: pointer;
  transition: transform .2s, background .2s, color .2s;
}
.result-copy:hover { transform: translateY(-1px); background: #c9e9e4; }
.result-copy.copied { border-color: var(--teal); background: var(--teal); color: #fff; }
.result-passcode {
  flex: 1;
  color: #81550f;
  font-size: 20px;
  letter-spacing: .26em;
  line-height: 1;
}
.code-copy { border-color: rgba(217, 154, 50, .25); background: var(--gold-soft); color: #81550f; }
.code-copy:hover { background: #f2dfbb; }
.code-copy.copied { border-color: #9f6a16; background: #9f6a16; color: #fff; }
.result-empty { flex: 1; color: var(--muted); font-size: 10px; }
.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 0 12px;
  border-top: 1px dashed var(--line);
}
.result-meta span {
  padding: 4px 7px;
  border-radius: 999px;
  background: rgba(16, 24, 34, .045);
  color: var(--muted);
  font-size: 8px;
}
.copy-all {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 13px 15px;
  border: 1px solid rgba(239, 84, 56, .18);
  border-radius: 15px;
  background: linear-gradient(100deg, rgba(253, 228, 220, .72), rgba(248, 234, 208, .58));
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: transform .22s, border-color .22s, box-shadow .22s, background .22s;
}
.copy-all:hover {
  transform: translateY(-2px);
  border-color: rgba(239, 84, 56, .35);
  box-shadow: 0 12px 25px rgba(80, 47, 24, .09);
}
.copy-all > span {
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--coral);
  color: #fff;
  font-size: 17px;
}
.copy-all > div { display: grid; gap: 3px; min-width: 0; }
.copy-all strong { font-size: 11px; }
.copy-all small { color: var(--muted); font-size: 8px; }
.copy-all.copied { border-color: rgba(15, 118, 110, .35); background: var(--teal-soft); }
.copy-all.copied > span { background: var(--teal); }
.share-result-actions { align-items: center; }
.share-result-actions .btn { text-decoration: none; }

.dialog-enter-active, .dialog-leave-active { transition: opacity .25s ease; }
.dialog-enter-active .dialog, .dialog-leave-active .dialog { transition: transform .34s cubic-bezier(.2,.9,.2,1), opacity .25s; }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .dialog, .dialog-leave-to .dialog { opacity: 0; transform: translateY(18px) scale(.95); }
.share-reveal-enter-active, .share-reveal-leave-active { transition: opacity .28s ease; }
.share-reveal-enter-active .share-result-dialog { transition: transform .55s cubic-bezier(.16, 1, .3, 1), opacity .3s; }
.share-reveal-leave-active .share-result-dialog { transition: transform .22s ease, opacity .2s; }
.share-reveal-enter-from, .share-reveal-leave-to { opacity: 0; }
.share-reveal-enter-from .share-result-dialog { opacity: 0; transform: translateY(24px) scale(.93); }
.share-reveal-leave-to .share-result-dialog { opacity: 0; transform: translateY(10px) scale(.97); }
@keyframes success-pop {
  from { opacity: 0; transform: scale(.45) rotate(-18deg); }
  to { opacity: 1; transform: scale(1) rotate(0); }
}
@keyframes orbit-pulse {
  0%, 35% { opacity: .8; transform: scale(.68); }
  75%, 100% { opacity: 0; transform: scale(1.1); }
}

@media (max-width: 900px) {
  .list-head, .row { grid-template-columns: 28px minmax(0, 1fr) 90px 76px; }
  .head-time, .file-time { display: none; }
  .command-top { flex-wrap: wrap; }
  .search { flex-basis: 220px; }
  .global-row { grid-template-columns: 34px minmax(0, 1fr) 80px 52px; }
  .global-time { display: none; }
}
@media (max-width: 680px) {
  .toolbar { gap: 10px; }
  .crumbs { order: 3; flex-basis: 100%; }
  .list-head, .row { grid-template-columns: 25px minmax(0, 1fr) 62px; gap: 7px; }
  .head-size, .file-size { display: none; }
  .row { padding: 8px; }
  .row-actions { gap: 0; }
  .share-btn { display: none; }
  .command-actions { gap: 3px; }
  .command-actions .btn { padding: 6px 8px; }
  .clear-selection { margin-left: 0; }
  .action-grid { grid-template-columns: repeat(3, 1fr); }
  .share-options { grid-template-columns: 1fr; }
  .scope-switch { order: -1; }
  .command-top .search { flex-basis: 100%; order: 3; }
  .global-search-btn { order: 4; }
  .sort-select { order: 4; }
  .global-panel { padding: 14px; }
  .global-summary { align-items: flex-start; flex-direction: column; }
  .global-row { grid-template-columns: 34px minmax(0, 1fr) 48px; gap: 7px; }
  .global-size, .global-open { display: none; }
}
@media (max-width: 480px) {
  .selection-count { display: none; }
  .sort-select { flex: 1; width: auto; }
  .dialog { padding: 20px; border-radius: 22px; }
  .dialog-actions .btn { flex: 1; }
  .passcode-field { flex-direction: column; }
  .share-result-head h3 { font-size: 24px; }
  .result-card { padding-inline: 12px; }
  .result-copy { padding-inline: 8px; }
}
</style>
