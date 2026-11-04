<script setup>
import { computed, ref } from 'vue'
import { api } from '../api.js'
import { clearSession } from '../store.js'
import { notify } from '../toast.js'

const emit = defineEmits(['changed'])

const fileInput = ref(null)
const file = ref(null)
const preview = ref(null)
const selectedIds = ref([])
const uploading = ref(false)
const dragging = ref(false)
const confirmOpen = ref(false)
const confirmChecked = ref(false)
const running = ref(false)
const runResult = ref(null)
const runEntries = ref([])

const providerMeta = {
  baidu: { label: '百度网盘', short: '百', cls: 'baidu' },
  quark: { label: '夸克网盘', short: '夸', cls: 'quark' }
}

const entries = computed(() => preview.value?.entries || [])
const selectedEntries = computed(() =>
  entries.value.filter((entry) => selectedIds.value.includes(entry.id))
)
const exactMatchedEntries = computed(() =>
  entries.value.filter((entry) => entry.matchMethod === 'exact' && entry.status !== 'done')
)
const copyMatchedCount = computed(() =>
  entries.value.filter((entry) => entry.matchMethod === 'copy').length
)
const selectableEntries = computed(() =>
  entries.value.filter((entry) => entry.status !== 'done' && entry.status !== 'running')
)
const allSelectableSelected = computed(() =>
  selectableEntries.value.length > 0 &&
  selectableEntries.value.every((entry) => selectedIds.value.includes(entry.id))
)
const selectedBaidu = computed(() =>
  selectedEntries.value.filter((entry) => entry.provider === 'baidu').length
)
const selectedQuark = computed(() =>
  selectedEntries.value.filter((entry) => entry.provider === 'quark').length
)
const doneCount = computed(() => entries.value.filter((entry) => entry.status === 'done').length)
const failedCount = computed(() => entries.value.filter((entry) => entry.status === 'error').length)
const remainingCount = computed(() =>
  entries.value.filter((entry) => !['done', 'error'].includes(entry.status)).length
)

function openFilePicker() {
  if (!uploading.value) fileInput.value?.click()
}

function validateFile(nextFile) {
  if (!nextFile) return '没有读取到文件'
  if (!/\.xlsx$/i.test(nextFile.name)) return '只支持 .xlsx 格式的 Excel 文件'
  if (nextFile.size > 12 * 1024 * 1024) return '文件不能超过 12 MB'
  return ''
}

function resetPreview() {
  preview.value = null
  selectedIds.value = []
  runResult.value = null
  runEntries.value = []
  confirmOpen.value = false
}

async function chooseFile(nextFile) {
  const invalid = validateFile(nextFile)
  if (invalid) {
    notify(invalid, 'error')
    return
  }
  file.value = nextFile
  uploading.value = true
  resetPreview()
  try {
    const token = localStorage.getItem('ys_token')
    const response = await fetch('/api/delist/preview', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token || ''}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'X-File-Name': encodeURIComponent(nextFile.name)
      },
      body: nextFile
    })
    const data = await response.json().catch(() => ({}))
    if (response.status === 401) {
      clearSession()
      location.reload()
      return
    }
    if (!response.ok) throw new Error(data.error || '表格解析失败')

    data.entries = (data.entries || []).map((entry) => ({
      ...entry,
      status: 'pending',
      error: ''
    }))
    preview.value = data
    selectedIds.value = data.entries
      .filter((entry) => entry.matchMethod === 'exact')
      .map((entry) => entry.id)
    notify(
      data.summary.matched
        ? `扫描到 ${data.summary.matched} 个网盘资源，请核对后再执行下架`
        : '已扫描网盘 1-3 级目录，但没有找到同名资源',
      data.summary.matched ? 'success' : 'error'
    )
  } catch (err) {
    file.value = null
    notify(err.message, 'error')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function onFileChange(event) {
  chooseFile(event.target.files?.[0])
}

function onDrop(event) {
  dragging.value = false
  chooseFile(event.dataTransfer?.files?.[0])
}

function toggleEntry(entry) {
  if (['running', 'done'].includes(entry.status)) return
  selectedIds.value = selectedIds.value.includes(entry.id)
    ? selectedIds.value.filter((id) => id !== entry.id)
    : [...selectedIds.value, entry.id]
}

function toggleAll() {
  if (allSelectableSelected.value) {
    selectedIds.value = []
    return
  }
  selectedIds.value = selectableEntries.value.map((entry) => entry.id)
}

function selectExactMatches() {
  selectedIds.value = exactMatchedEntries.value.map((entry) => entry.id)
}

function statusMeta(entry) {
  switch (entry.status) {
    case 'running': return { label: '删除中', cls: 'running' }
    case 'done': return { label: '已下架', cls: 'done' }
    case 'error': return { label: '失败', cls: 'error' }
    default: return { label: '待下架', cls: '' }
  }
}

function rowsLabel(rows) {
  if (!rows?.length) return '表格行未知'
  if (rows.length <= 3) return `第 ${rows.join('、')} 行`
  return `第 ${rows.slice(0, 3).join('、')} 行等 ${rows.length} 行`
}

function openConfirm() {
  if (!selectedEntries.value.length) return notify('请至少勾选一条要下架的资源', 'error')
  confirmChecked.value = false
  runResult.value = null
  confirmOpen.value = true
}

function closeConfirm() {
  if (running.value) return
  confirmOpen.value = false
}

async function execute() {
  if (running.value || !confirmChecked.value) return
  const targets = [...selectedEntries.value]
  if (!targets.length) return

  running.value = true
  runResult.value = null
  runEntries.value = targets
  let succeeded = 0
  let failed = 0

  for (const entry of targets) {
    entry.status = 'running'
    entry.error = ''
    try {
      await api.post('/delist/execute', { accountId: entry.accountId, path: entry.path })
      entry.status = 'done'
      succeeded++
    } catch (err) {
      entry.status = 'error'
      entry.error = err.message
      failed++
    }
  }

  running.value = false
  runResult.value = { succeeded, failed }
  selectedIds.value = targets
    .filter((entry) => entry.status === 'error')
    .map((entry) => entry.id)
  emit('changed')
  notify(
    failed
      ? `批量下架完成：成功 ${succeeded} 条，失败 ${failed} 条`
      : `已成功下架 ${succeeded} 条资源`,
    failed ? 'error' : 'success'
  )
}
</script>

<template>
  <div class="delist">
    <section class="card upload-card">
      <div class="upload-intro">
        <div class="eyebrow">RESOURCE RETIREMENT</div>
        <h3 class="display">用一张表，清理已保存的资源。</h3>
        <p class="muted">
          导入 XLSX 后，云梭会识别百度、夸克分享链接，并直接扫描对应网盘账号的 1-3 级目录，用资源名称匹配真实文件。上传只做预览，不会立即删除。
        </p>
        <div class="safety-steps">
          <div class="safety-step">
            <span class="mono">01</span>
            <div><strong>解析表格</strong><small>自动去重链接并定位行号</small></div>
          </div>
          <div class="safety-step">
            <span class="mono">02</span>
            <div><strong>扫描网盘</strong><small>深入 1-3 级目录定位同名文件</small></div>
          </div>
          <div class="safety-step">
            <span class="mono">03</span>
            <div><strong>确认下架</strong><small>再次确认后才调用网盘删除</small></div>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="dropzone"
        :class="{ dragging, loading: uploading, filled: file && preview }"
        @click="openFilePicker"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <span class="drop-orbit">
          <i />
          <b>{{ uploading ? '…' : file && preview ? '✓' : '↓' }}</b>
        </span>
        <span class="drop-kicker mono">{{ uploading ? 'SCANNING NETDISK' : 'XLSX IMPORT' }}</span>
        <strong class="display">
          {{ uploading ? '正在解析表格并扫描网盘…' : preview ? preview.fileName || file?.name : '把表格拖到这里' }}
        </strong>
        <small v-if="!preview">
          支持百度 / 夸克分享链接，最大 12 MB
        </small>
        <small v-else>
          {{ preview.summary.rows }} 行 · {{ preview.summary.links }} 个唯一链接
        </small>
        <span class="browse-pill">{{ preview ? '重新选择表格' : '选择 XLSX 文件' }}</span>
      </button>
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        @change="onFileChange"
      />
    </section>

    <Transition name="preview">
      <div v-if="preview" class="preview-stack">
        <div class="summary-grid stagger">
          <article class="summary-stat card" style="--i: 0">
            <span class="mono">UNIQUE LINKS</span>
            <strong>{{ preview.summary.links }}</strong>
            <small>表格内唯一分享链接</small>
          </article>
          <article class="summary-stat card accent" style="--i: 1">
            <span class="mono">MATCHED</span>
            <strong>{{ preview.summary.matched }}</strong>
            <small>网盘中匹配到的真实资源</small>
          </article>
          <article class="summary-stat card" style="--i: 2">
            <span class="mono">BAIDU</span>
            <strong>{{ preview.summary.baidu }}</strong>
            <small>百度网盘资源</small>
          </article>
          <article class="summary-stat card" style="--i: 3">
            <span class="mono">QUARK</span>
            <strong>{{ preview.summary.quark }}</strong>
            <small>夸克网盘资源</small>
          </article>
          <article class="summary-stat card muted-stat" style="--i: 4">
            <span class="mono">UNMATCHED</span>
            <strong>{{ preview.summary.unmatched }}</strong>
            <small>网盘中未找到同名资源</small>
          </article>
        </div>

        <section class="card matches-card">
          <header class="matches-head">
            <div>
              <div class="eyebrow">MATCHED RESOURCES</div>
              <h3 class="display">核对下架清单</h3>
              <p class="muted">默认只勾选网盘内名称完全一致的资源；带“ (2)”等副本后缀的匹配需要你手动确认。</p>
            </div>
            <div class="head-actions">
              <button class="btn btn-ghost mini" @click="selectExactMatches">仅选精确匹配</button>
              <button class="btn btn-ghost mini" @click="toggleAll">
                {{ allSelectableSelected ? '取消全选' : '全选可处理项' }}
              </button>
            </div>
          </header>

          <div v-if="copyMatchedCount" class="match-warning">
            <span class="warning-mark">!</span>
            <p>
              有 <strong>{{ copyMatchedCount }}</strong> 个网盘文件通过副本后缀匹配，默认未勾选。请确认它们确实对应表格中的资源后再处理。
            </p>
          </div>

          <details v-if="preview.warnings?.length" class="scan-warning">
            <summary>
              <span class="warning-mark">!</span>
              <strong>{{ preview.warnings.length }} 个账号或目录未能完整扫描</strong>
              <b>⌄</b>
            </summary>
            <div class="scan-warning-list">
              <p v-for="(warning, index) in preview.warnings" :key="`${warning.accountId}-${index}`">
                {{ warning.accountLabel || warning.providerName }}：{{ warning.error }}
              </p>
            </div>
          </details>

          <div v-if="!entries.length" class="empty-result">
            <span>⌕</span>
            <strong>没有匹配到可下架的资源</strong>
            <p>请确认表格中的资源名称与网盘内文件或文件夹名称一致，并检查对应网盘账号是否已登录。</p>
          </div>

          <div v-else class="entry-list">
            <article
              v-for="(entry, index) in entries"
              :key="entry.id"
              class="entry-row"
              :class="[statusMeta(entry).cls, { selected: selectedIds.includes(entry.id) }]"
              :style="{ '--i': index }"
              @click="toggleEntry(entry)"
            >
              <label class="entry-check" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(entry.id)"
                  :disabled="['running', 'done'].includes(entry.status)"
                  @change="toggleEntry(entry)"
                />
                <i />
              </label>

              <span class="provider-mark" :class="providerMeta[entry.provider]?.cls">
                {{ providerMeta[entry.provider]?.short || '云' }}
              </span>

              <div class="entry-main">
                <strong :title="entry.name">{{ entry.name }}</strong>
                <span class="path" :title="entry.path">{{ entry.path }}</span>
                <div class="entry-tags">
                  <span>{{ providerMeta[entry.provider]?.label }}</span>
                  <span>{{ entry.accountLabel }}</span>
                  <span :class="{ fallback: entry.matchMethod === 'copy' }">
                    {{ entry.matchMethod === 'exact' ? '名称精确匹配' : '副本后缀匹配' }}
                  </span>
                  <span v-if="entry.recordCount > 1">{{ entry.recordCount }} 个表格链接指向此资源</span>
                </div>
              </div>

              <div class="entry-source">
                <span class="tiny muted">表格来源</span>
                <strong>{{ rowsLabel(entry.sourceRows) }}</strong>
                <small :title="entry.sourceTitle">{{ entry.sourceTitle }}</small>
              </div>

              <span class="entry-status" :class="statusMeta(entry).cls">
                <i />
                {{ statusMeta(entry).label }}
              </span>
            </article>
          </div>
        </section>

        <details v-if="preview.unmatched.length" class="card unmatched-card">
          <summary>
            <div>
              <div class="eyebrow">NOT FOUND IN NETDISK</div>
              <h3 class="display">网盘中未找到的资源</h3>
            </div>
            <span class="tag">{{ preview.unmatched.length }} 条</span>
            <b>⌄</b>
          </summary>
          <div class="unmatched-list">
            <div v-for="item in preview.unmatched" :key="item.canonical" class="unmatched-row">
              <span class="provider-mark" :class="providerMeta[item.provider]?.cls">
                {{ providerMeta[item.provider]?.short || '云' }}
              </span>
              <div>
                <strong>{{ item.sourceTitle }}</strong>
                <small>{{ item.providerName }} · {{ item.reason }}</small>
              </div>
              <span class="unmatched-key mono">{{ item.canonical.split(':').pop() }}</span>
            </div>
          </div>
        </details>

        <section class="execute-bar card">
          <div class="selection-copy">
            <span class="mono">SELECTED FOR DELIST</span>
            <strong>{{ selectedEntries.length }} 条待处理</strong>
            <small>
              百度 {{ selectedBaidu }} · 夸克 {{ selectedQuark }}；将按上方的网盘账号与真实路径删除
            </small>
          </div>
          <div class="execute-progress">
            <span><i :style="{ width: `${entries.length ? ((doneCount + failedCount) / entries.length) * 100 : 0}%` }" /></span>
            <small>{{ doneCount }} 成功 / {{ failedCount }} 失败 / {{ remainingCount }} 待处理</small>
          </div>
          <button class="btn btn-danger" :disabled="!selectedEntries.length || running" @click="openConfirm">
            确认下架 {{ selectedEntries.length ? `(${selectedEntries.length})` : '' }}
          </button>
        </section>
      </div>
    </Transition>

    <Transition name="dialog">
      <div v-if="confirmOpen" class="modal-layer" @click.self="closeConfirm">
        <section class="confirm-modal">
          <header class="modal-head">
            <span class="modal-icon">⌫</span>
            <div>
              <span class="mono">FINAL CONFIRMATION</span>
              <h3 class="display">{{ runResult ? '批量下架结果' : '确认从网盘删除？' }}</h3>
            </div>
            <button class="modal-close" :disabled="running" @click="closeConfirm">×</button>
          </header>

          <div v-if="!runResult" class="confirm-body">
            <p class="confirm-lead">
              将处理 <strong>{{ selectedEntries.length }}</strong> 条资源，其中百度 {{ selectedBaidu }} 条、夸克 {{ selectedQuark }} 条。
              文件和文件夹会直接从对应网盘账号中删除，请再次核对账号与路径。
            </p>
            <div class="confirm-list">
              <div v-for="entry in selectedEntries.slice(0, 6)" :key="entry.id">
                <span class="provider-mark" :class="providerMeta[entry.provider]?.cls">
                  {{ providerMeta[entry.provider]?.short }}
                </span>
                <div><strong>{{ entry.name }}</strong><small>{{ entry.accountLabel }} · {{ entry.path }}</small></div>
              </div>
              <p v-if="selectedEntries.length > 6">另有 {{ selectedEntries.length - 6 }} 条资源未展开</p>
            </div>
            <label class="confirm-check">
              <input v-model="confirmChecked" type="checkbox" :disabled="running" />
              <span>
                我已核对资源名称与账号，确认从网盘删除这些文件
              </span>
            </label>

            <div v-if="running" class="run-panel">
              <div class="run-panel-head">
                <strong>正在逐条处理</strong>
                <span>{{ runEntries.filter(e => ['done', 'error'].includes(e.status)).length }} / {{ runEntries.length }}</span>
              </div>
              <div class="run-list">
                <div v-for="entry in runEntries" :key="entry.id">
                  <span class="run-state" :class="statusMeta(entry).cls"><i /></span>
                  <strong>{{ entry.name }}</strong>
                  <small>{{ statusMeta(entry).label }}</small>
                </div>
              </div>
            </div>

            <div class="modal-actions">
              <button class="btn btn-ghost" :disabled="running" @click="closeConfirm">取消</button>
              <button class="btn btn-danger" :disabled="!confirmChecked || running" @click="execute">
                {{ running ? '正在下架…' : `确认下架 ${selectedEntries.length} 条` }}
              </button>
            </div>
          </div>

          <div v-else class="result-body">
            <div class="result-seal" :class="{ partial: runResult.failed }">
              {{ runResult.failed ? '!' : '✓' }}
            </div>
            <div class="result-numbers">
              <div><span>成功</span><strong>{{ runResult.succeeded }}</strong></div>
              <div><span>失败</span><strong class="failed">{{ runResult.failed }}</strong></div>
            </div>
            <p v-if="runResult.failed" class="result-message">
              失败项已保留在清单中并标记为红色。常见原因是 Cookie 失效、文件已被移动或删除。修正后可重新勾选重试。
            </p>
            <p v-else class="result-message">本次选中的资源已从对应网盘账号中删除。</p>
            <div class="modal-actions">
              <button class="btn btn-primary" @click="closeConfirm">完成</button>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.delist { display: grid; gap: 24px; }
.upload-card {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, .95fr);
  gap: 34px;
  padding: 30px;
  overflow: visible;
}
.upload-intro { display: grid; align-content: center; gap: 13px; }
.upload-intro h3 { margin: 0; max-width: 590px; font-size: clamp(27px, 3vw, 39px); line-height: 1.18; }
.upload-intro > p { margin: 0; max-width: 610px; font-size: 12px; line-height: 1.8; }
.safety-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-top: 7px; }
.safety-step {
  display: grid;
  grid-template-columns: 25px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 11px;
  border: 1px solid var(--line-soft);
  border-radius: 14px;
  background: rgba(255, 253, 248, .38);
}
.safety-step > span { color: var(--coral); font-size: 8px; letter-spacing: .12em; padding-top: 2px; }
.safety-step > div { display: grid; gap: 3px; }
.safety-step strong { font-size: 11px; }
.safety-step small { color: var(--muted); font-size: 8px; line-height: 1.5; }
.dropzone {
  position: relative;
  min-height: 310px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 9px;
  padding: 28px;
  border: 1px dashed rgba(239, 84, 56, .34);
  border-radius: 24px;
  background:
    radial-gradient(circle at 50% 26%, rgba(239, 84, 56, .12), transparent 32%),
    linear-gradient(145deg, rgba(255, 253, 248, .7), rgba(239, 84, 56, .035));
  color: var(--ink);
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  transition: transform .26s cubic-bezier(.2,.8,.2,1), border-color .24s, background .24s, box-shadow .24s;
}
.dropzone::before,
.dropzone::after {
  content: "";
  position: absolute;
  width: 140px;
  height: 140px;
  border: 1px solid rgba(239, 84, 56, .12);
  border-radius: 50%;
  pointer-events: none;
}
.dropzone::before { left: -72px; top: -56px; box-shadow: 0 0 0 24px rgba(239,84,56,.025); }
.dropzone::after { right: -65px; bottom: -58px; box-shadow: 0 0 0 30px rgba(239,84,56,.018); }
.dropzone:hover,
.dropzone.dragging {
  transform: translateY(-3px);
  border-color: rgba(239, 84, 56, .68);
  background:
    radial-gradient(circle at 50% 26%, rgba(239, 84, 56, .18), transparent 35%),
    linear-gradient(145deg, rgba(255, 253, 248, .86), rgba(239, 84, 56, .06));
  box-shadow: 0 24px 55px rgba(239, 84, 56, .12);
}
.dropzone.dragging { transform: scale(1.012); }
.dropzone.loading { cursor: wait; }
.dropzone.filled { border-style: solid; border-color: rgba(15, 118, 110, .28); }
.drop-orbit {
  position: relative;
  width: 76px;
  height: 76px;
  display: grid;
  place-items: center;
  margin-bottom: 5px;
  border-radius: 50%;
  background: linear-gradient(145deg, var(--coral), #ce3d24);
  box-shadow: 0 18px 42px rgba(239, 84, 56, .28);
}
.dropzone.filled .drop-orbit { background: linear-gradient(145deg, var(--teal), #0a665f); box-shadow: 0 18px 42px rgba(15,118,110,.24); }
.drop-orbit::before,
.drop-orbit::after {
  content: "";
  position: absolute;
  inset: -10px;
  border: 1px solid rgba(239, 84, 56, .2);
  border-radius: 50%;
  animation: orbit 3.4s ease-out infinite;
}
.drop-orbit::after { animation-delay: 1.7s; }
.drop-orbit b { color: #fff; font-size: 30px; font-weight: 400; line-height: 1; }
.drop-kicker { color: var(--coral); font-size: 8px; letter-spacing: .22em; }
.dropzone > strong { max-width: 100%; font-size: 23px; line-height: 1.25; overflow-wrap: anywhere; }
.dropzone > small { color: var(--muted); font-size: 10px; }
.browse-pill {
  margin-top: 8px;
  padding: 9px 17px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 253, 248, .75);
  font-size: 11px;
  font-weight: 800;
}
.file-input { display: none; }
.preview-stack { display: grid; gap: 20px; }
.summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 11px; }
.summary-stat { min-height: 126px; display: grid; align-content: space-between; gap: 5px; padding: 17px; }
.summary-stat > span { color: var(--muted); font-size: 7px; letter-spacing: .16em; }
.summary-stat > strong { font-family: var(--display); font-size: 33px; line-height: 1; }
.summary-stat > small { color: var(--muted); font-size: 9px; line-height: 1.45; }
.summary-stat.accent { background: linear-gradient(145deg, rgba(239, 84, 56, .13), var(--card-b)); border-color: rgba(239, 84, 56, .2); }
.summary-stat.accent > strong { color: var(--coral); }
.summary-stat.muted-stat > strong { color: var(--muted); }
.matches-card { padding: 24px; overflow: visible; }
.matches-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 17px; }
.matches-head h3 { margin: 5px 0 4px; font-size: 27px; }
.matches-head p { margin: 0; font-size: 10px; line-height: 1.65; }
.head-actions { display: flex; gap: 7px; flex-wrap: wrap; justify-content: flex-end; }
.mini { padding: 8px 13px; font-size: 10px; }
.match-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 13px;
  margin-bottom: 12px;
  border: 1px solid rgba(217, 154, 50, .22);
  border-radius: 14px;
  background: rgba(248, 234, 208, .5);
}
.warning-mark {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--gold);
  color: #fff;
  font-size: 12px;
  font-weight: 900;
}
.match-warning p { margin: 1px 0 0; color: #73531d; font-size: 10px; line-height: 1.65; }
.scan-warning {
  margin-bottom: 12px;
  border: 1px solid rgba(180, 35, 24, .14);
  border-radius: 14px;
  background: rgba(180, 35, 24, .04);
}
.scan-warning summary {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 13px;
  list-style: none;
  cursor: pointer;
}
.scan-warning summary::-webkit-details-marker { display: none; }
.scan-warning summary strong { flex: 1; font-size: 10px; }
.scan-warning summary > b { color: var(--muted); transition: transform .2s; }
.scan-warning[open] summary > b { transform: rotate(180deg); }
.scan-warning-list { display: grid; gap: 5px; padding: 0 13px 11px 44px; }
.scan-warning-list p { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.6; }
.entry-list { display: grid; gap: 7px; }
.entry-row {
  display: grid;
  grid-template-columns: 25px 38px minmax(220px, 1fr) minmax(155px, .62fr) 80px;
  align-items: center;
  gap: 12px;
  min-height: 78px;
  padding: 11px 13px;
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background: rgba(255, 253, 248, .52);
  cursor: pointer;
  opacity: 0;
  transform: translateY(8px);
  animation: reveal .42s cubic-bezier(.2,.8,.2,1) forwards;
  animation-delay: calc(min(var(--i), 10) * 30ms);
  transition: background .2s, border-color .2s, transform .2s;
}
.entry-row:hover { transform: translateX(2px); border-color: rgba(16, 24, 34, .14); background: rgba(255, 253, 248, .82); }
.entry-row.selected { border-color: rgba(239, 84, 56, .22); background: linear-gradient(90deg, rgba(239,84,56,.075), rgba(255,253,248,.62)); }
.entry-row.done { opacity: .58; background: rgba(15, 118, 110, .055); }
.entry-row.error { border-color: rgba(180, 35, 24, .2); background: rgba(180, 35, 24, .045); }
.entry-row.running { border-color: rgba(217, 154, 50, .35); background: rgba(248, 234, 208, .36); }
.entry-check { width: 20px; height: 20px; position: relative; display: grid; place-items: center; cursor: pointer; }
.entry-check input { position: absolute; opacity: 0; pointer-events: none; }
.entry-check i {
  width: 18px;
  height: 18px;
  border: 1px solid rgba(16, 24, 34, .24);
  border-radius: 6px;
  background: rgba(255, 253, 248, .8);
  transition: .18s;
}
.entry-check input:checked + i {
  border-color: var(--coral);
  background: var(--coral);
  box-shadow: inset 0 0 0 4px rgba(255,255,255,.9);
}
.entry-check input:disabled + i { opacity: .35; }
.provider-mark {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.25);
}
.provider-mark.baidu { background: linear-gradient(145deg, #3478f6, #2458b8); }
.provider-mark.quark { background: linear-gradient(145deg, #5b6ee8, #3a46b8); }
.entry-main { display: grid; gap: 4px; min-width: 0; }
.entry-main > strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.entry-main .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-family: var(--mono); font-size: 8px; }
.entry-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.entry-tags span {
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--ink-soft);
  color: var(--muted);
  font-size: 8px;
  font-weight: 700;
}
.entry-tags span.fallback { background: var(--gold-soft); color: #85601f; }
.entry-source { display: grid; gap: 3px; min-width: 0; }
.entry-source strong { font-size: 10px; }
.entry-source small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 8px; }
.entry-status { display: flex; align-items: center; justify-content: flex-end; gap: 5px; color: var(--muted); font-size: 9px; font-weight: 800; }
.entry-status i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.entry-status.running { color: var(--gold); }
.entry-status.running i { animation: pulse 1s infinite; }
.entry-status.done { color: var(--teal); }
.entry-status.error { color: #b42318; }
.empty-result { min-height: 210px; display: grid; place-items: center; align-content: center; gap: 7px; text-align: center; color: var(--muted); }
.empty-result > span { font-size: 37px; opacity: .25; }
.empty-result strong { color: var(--ink); font-size: 13px; }
.empty-result p { max-width: 460px; margin: 0; font-size: 10px; line-height: 1.7; }
.unmatched-card { overflow: visible; }
.unmatched-card summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 22px;
  list-style: none;
  cursor: pointer;
}
.unmatched-card summary::-webkit-details-marker { display: none; }
.unmatched-card summary > div { flex: 1; }
.unmatched-card summary h3 { margin: 3px 0 0; font-size: 21px; }
.unmatched-card summary > b { color: var(--muted); transition: transform .22s; }
.unmatched-card[open] summary > b { transform: rotate(180deg); }
.unmatched-list { display: grid; gap: 7px; padding: 0 16px 16px; }
.unmatched-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 12px;
  background: var(--ink-soft);
}
.unmatched-row .provider-mark { width: 30px; height: 30px; border-radius: 10px; font-size: 11px; }
.unmatched-row > div { display: grid; gap: 3px; min-width: 0; }
.unmatched-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.unmatched-row small { color: var(--muted); font-size: 8px; }
.unmatched-key { color: var(--muted); font-size: 8px; }
.execute-bar {
  position: sticky;
  bottom: 15px;
  z-index: 10;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(190px, .35fr) auto;
  align-items: center;
  gap: 22px;
  padding: 16px 18px;
  backdrop-filter: blur(22px);
  background: linear-gradient(100deg, rgba(255,253,248,.95), rgba(246,240,229,.91));
  box-shadow: 0 22px 70px rgba(16, 24, 34, .16);
  overflow: visible;
}
.selection-copy { display: grid; gap: 3px; }
.selection-copy > span { color: var(--coral); font-size: 7px; letter-spacing: .17em; }
.selection-copy > strong { font-family: var(--display); font-size: 20px; }
.selection-copy > small { color: var(--muted); font-size: 9px; }
.execute-progress { display: grid; gap: 6px; }
.execute-progress > span { height: 6px; border-radius: 999px; background: var(--ink-soft); overflow: hidden; }
.execute-progress i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--teal), var(--gold)); transition: width .4s; }
.execute-progress small { color: var(--muted); font-size: 8px; }
.btn-danger {
  color: #fff;
  background: linear-gradient(135deg, #c43325, #8f2118);
  box-shadow: 0 12px 26px rgba(150, 38, 27, .25);
}
.btn-danger:hover { box-shadow: 0 17px 34px rgba(150, 38, 27, .32); }
.preview-enter-active { transition: opacity .38s ease, transform .45s cubic-bezier(.2,.8,.2,1); }
.preview-enter-from { opacity: 0; transform: translateY(16px); }
.modal-layer {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(16, 24, 34, .55);
  backdrop-filter: blur(13px);
}
.confirm-modal {
  position: relative;
  width: min(650px, 100%);
  max-height: min(820px, calc(100vh - 36px));
  overflow-y: auto;
  padding: 25px;
  border: 1px solid rgba(255,255,255,.22);
  border-radius: 27px;
  background: linear-gradient(150deg, var(--card-a), var(--card-b));
  box-shadow: 0 45px 120px rgba(9, 15, 22, .42);
}
.modal-head { display: flex; align-items: center; gap: 12px; padding-right: 30px; }
.modal-icon {
  width: 47px;
  height: 47px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 15px;
  background: linear-gradient(145deg, #c43325, #8f2118);
  color: #fff;
  font-size: 20px;
  box-shadow: 0 13px 26px rgba(143, 33, 24, .22);
}
.modal-head > div { display: grid; gap: 3px; }
.modal-head span { color: var(--coral); font-size: 7px; letter-spacing: .18em; }
.modal-head h3 { margin: 0; font-size: 27px; }
.modal-close {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: var(--ink-soft);
  color: var(--muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.modal-close:disabled { opacity: .35; cursor: not-allowed; }
.confirm-body,
.result-body { display: grid; gap: 16px; margin-top: 20px; }
.confirm-lead { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.8; }
.confirm-lead strong { color: var(--ink); }
.confirm-list {
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid rgba(180, 35, 24, .12);
  border-radius: 16px;
  background: rgba(180, 35, 24, .035);
}
.confirm-list > div { display: grid; grid-template-columns: 31px minmax(0, 1fr); align-items: center; gap: 9px; padding: 5px 3px; }
.confirm-list .provider-mark { width: 29px; height: 29px; border-radius: 9px; font-size: 10px; }
.confirm-list > div > div { display: grid; gap: 2px; min-width: 0; }
.confirm-list strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.confirm-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-family: var(--mono); font-size: 8px; }
.confirm-list > p { margin: 4px 3px 0; color: var(--muted); font-size: 9px; }
.confirm-check {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(239, 84, 56, .07);
  color: #7e3026;
  font-size: 10px;
  line-height: 1.6;
  cursor: pointer;
}
.confirm-check input { accent-color: var(--coral); margin-top: 2px; }
.run-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 15px;
  background: var(--ink-soft);
}
.run-panel-head { display: flex; justify-content: space-between; font-size: 10px; }
.run-panel-head span { color: var(--muted); font-family: var(--mono); font-size: 9px; }
.run-list { max-height: 190px; display: grid; gap: 5px; overflow-y: auto; }
.run-list > div {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 7px 8px;
  border-radius: 9px;
  background: rgba(255, 253, 248, .55);
}
.run-list strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; }
.run-list small { color: var(--muted); font-size: 8px; }
.run-state i { display: block; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
.run-state.running i { background: var(--gold); animation: pulse 1s infinite; }
.run-state.done i { background: var(--teal); }
.run-state.error i { background: #b42318; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.result-body { justify-items: center; text-align: center; }
.result-seal {
  width: 82px;
  height: 82px;
  display: grid;
  place-items: center;
  margin-top: 4px;
  border-radius: 50%;
  background: linear-gradient(145deg, var(--teal), #0b675f);
  color: #fff;
  font-size: 37px;
  box-shadow: 0 20px 45px rgba(15, 118, 110, .24);
  animation: success-pop .5s cubic-bezier(.2,1.2,.3,1);
}
.result-seal.partial { background: linear-gradient(145deg, var(--gold), #b77b1d); box-shadow: 0 20px 45px rgba(183, 123, 29, .24); }
.result-numbers { width: min(310px, 100%); display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.result-numbers > div { display: grid; gap: 3px; padding: 12px; border-radius: 14px; background: var(--teal-soft); }
.result-numbers > div:last-child { background: var(--coral-soft); }
.result-numbers span { color: var(--muted); font-size: 9px; }
.result-numbers strong { font-family: var(--display); font-size: 29px; line-height: 1; }
.result-numbers strong.failed { color: var(--coral); }
.result-message { max-width: 480px; margin: 0; color: var(--muted); font-size: 10px; line-height: 1.75; }
.dialog-enter-active, .dialog-leave-active { transition: opacity .22s ease; }
.dialog-enter-active .confirm-modal, .dialog-leave-active .confirm-modal { transition: opacity .24s, transform .32s cubic-bezier(.2,.9,.2,1); }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .confirm-modal, .dialog-leave-to .confirm-modal { opacity: 0; transform: translateY(18px) scale(.96); }
@keyframes orbit {
  0% { opacity: .7; transform: scale(.74); }
  85%, 100% { opacity: 0; transform: scale(1.18); }
}
@media (max-width: 1050px) {
  .upload-card { grid-template-columns: 1fr; }
  .dropzone { min-height: 270px; }
  .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .entry-row { grid-template-columns: 25px 38px minmax(0, 1fr) 74px; }
  .entry-source { grid-column: 3; grid-row: 2; }
  .entry-status { grid-column: 4; grid-row: 1 / span 2; }
  .execute-bar { grid-template-columns: minmax(0, 1fr) auto; }
  .execute-progress { display: none; }
}
@media (max-width: 720px) {
  .upload-card { padding: 20px; gap: 23px; }
  .safety-steps { grid-template-columns: 1fr; }
  .dropzone { min-height: 245px; padding: 20px; }
  .dropzone > strong { font-size: 20px; }
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .summary-stat { min-height: 108px; }
  .summary-stat:last-child { grid-column: 1 / -1; }
  .matches-card { padding: 17px; }
  .matches-head { align-items: flex-start; flex-direction: column; gap: 12px; }
  .head-actions { width: 100%; justify-content: flex-start; }
  .entry-row { grid-template-columns: 24px 34px minmax(0, 1fr); gap: 9px; }
  .entry-status { grid-column: 3; grid-row: auto; justify-content: flex-start; }
  .entry-source { grid-column: 3; grid-row: auto; }
  .execute-bar {
    position: static;
    grid-template-columns: 1fr;
    padding: 15px;
  }
  .execute-bar .btn { width: 100%; }
  .modal-layer { padding: 10px; }
  .confirm-modal { max-height: calc(100vh - 20px); padding: 20px; border-radius: 22px; }
  .modal-head h3 { font-size: 23px; }
  .modal-close {
    position: absolute;
    top: 18px;
    right: 18px;
    margin-left: 0;
  }
  .modal-actions .btn { flex: 1; }
}
</style>
