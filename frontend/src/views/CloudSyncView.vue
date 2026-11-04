<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api.js'
import CloudPathPickerModal from '../components/CloudPathPickerModal.vue'
import { fmtTime } from '../format.js'
import { store } from '../store.js'
import { notify } from '../toast.js'

const providerMeta = {
  baidu: {
    name: '百度网盘',
    short: '百',
    tone: 'blue',
    note: '分享后转存至夸克'
  },
  quark: {
    name: '夸克网盘',
    short: '夸',
    tone: 'orange',
    note: '分享后转存至百度'
  }
}

const sourceAccountId = ref('')
const destinationAccountId = ref('')
const sourcePath = ref('/')
const destinationPath = ref(defaultDestinationPath())
const pickerMode = ref('')
const pickerOpen = ref(false)
const submitting = ref(false)
const tasks = ref([])
let pollTimer = null

const syncAccounts = computed(() =>
  (store.accounts || []).filter((account) => ['baidu', 'quark'].includes(account.provider))
)
const sourceAccount = computed(() =>
  syncAccounts.value.find((account) => account.id === sourceAccountId.value) || null
)
const destinationAccount = computed(() =>
  syncAccounts.value.find((account) => account.id === destinationAccountId.value) || null
)
const sourceOptions = computed(() => syncAccounts.value)
const destinationOptions = computed(() =>
  syncAccounts.value.filter((account) => account.provider !== sourceAccount.value?.provider)
)
const sourceMeta = computed(() => providerMeta[sourceAccount.value?.provider] || null)
const destinationMeta = computed(() => providerMeta[destinationAccount.value?.provider] || null)
const canSubmit = computed(() =>
  !!sourceAccount.value &&
  !!destinationAccount.value &&
  sourceAccount.value.provider !== destinationAccount.value.provider &&
  sourcePath.value !== '/' &&
  !!destinationPath.value.trim() &&
  !submitting.value
)
const sourceName = computed(() => sourcePath.value.split('/').filter(Boolean).pop() || '尚未选择')
const destinationName = computed(() => destinationPath.value || '/')
const availableDirections = computed(() => ({
  baidu: syncAccounts.value.some((account) => account.provider === 'baidu'),
  quark: syncAccounts.value.some((account) => account.provider === 'quark')
}))

function defaultDestinationPath() {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `/跨盘同步/${values.year}-${values.month}-${values.day}`
}

function ensureAccounts() {
  if (!syncAccounts.value.length) {
    sourceAccountId.value = ''
    destinationAccountId.value = ''
    return
  }
  if (!sourceAccount.value) {
    sourceAccountId.value = (
      syncAccounts.value.find((account) => account.provider === 'baidu') ||
      syncAccounts.value[0]
    ).id
  }
  if (!destinationAccount.value || destinationAccount.value.provider === sourceAccount.value?.provider) {
    destinationAccountId.value =
      destinationOptions.value[0]?.id ||
      syncAccounts.value.find((account) => account.id !== sourceAccount.value?.id)?.id ||
      ''
  }
}

function changeSource() {
  sourcePath.value = '/'
  if (destinationAccount.value?.provider === sourceAccount.value?.provider) {
    destinationAccountId.value = destinationOptions.value[0]?.id || ''
  }
}

function swapDirection() {
  const previousSource = sourceAccountId.value
  sourceAccountId.value = destinationAccountId.value
  destinationAccountId.value = previousSource
  sourcePath.value = '/'
  destinationPath.value = defaultDestinationPath()
  notify('已交换同步方向', 'success')
}

function openPicker(mode) {
  pickerMode.value = mode
  pickerOpen.value = true
}

function choosePath(path) {
  if (pickerMode.value === 'source') sourcePath.value = path
  if (pickerMode.value === 'destination') destinationPath.value = path
  pickerOpen.value = false
}

function statusMeta(task) {
  switch (task.status) {
    case 'queued': return { label: '等待中', cls: 'gold' }
    case 'running': return { label: '同步中', cls: 'teal' }
    case 'done': return { label: task.detail?.skipped ? '无需更新' : '已完成', cls: 'teal' }
    case 'error': return { label: '失败', cls: 'coral' }
    case 'canceled': return { label: '已取消', cls: 'muted' }
    default: return { label: task.status, cls: 'muted' }
  }
}

async function loadTasks() {
  try {
    tasks.value = await api.get('/tasks?kind=cloud-sync')
  } catch {
    // 任务轮询失败不阻塞同步表单。
  }
}

async function startSync() {
  if (!canSubmit.value) {
    if (!availableDirections.value.baidu || !availableDirections.value.quark) {
      return notify('请先在网盘账号中添加百度网盘和夸克网盘账号', 'error')
    }
    if (sourcePath.value === '/') return notify('请选择要同步的文件或文件夹', 'error')
    return notify('请检查源账号、目标账号和目标目录', 'error')
  }

  submitting.value = true
  try {
    const result = await api.post('/cloud-sync/sync', {
      sourceAccountId: sourceAccountId.value,
      destinationAccountId: destinationAccountId.value,
      sourcePath: sourcePath.value,
      destinationPath: destinationPath.value
    })
    notify('跨盘同步任务已创建', 'success')
    await loadTasks()
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    submitting.value = false
  }
}

watch(() => store.accounts, ensureAccounts, { deep: true, immediate: true })
watch(sourceAccountId, changeSource)

onMounted(() => {
  ensureAccounts()
  loadTasks()
  pollTimer = setInterval(loadTasks, 2200)
})

onUnmounted(() => clearInterval(pollTimer))
</script>

<template>
  <div class="cloud-sync">
    <section class="sync-hero card">
      <div class="hero-copy">
        <span class="mono hero-kicker">CLOUD BRIDGE · ONE WAY</span>
        <h3 class="display">从一朵云，抵达另一朵云。</h3>
        <p>
          通过临时分享完成百度与夸克之间的跨盘搬运，不需要先下载到本地。
          目标目录已有同名文件时会自动跳过，避免重复占用空间。
        </p>
        <div class="hero-badges">
          <span><i />服务端中转</span>
          <span><i />增量去重</span>
          <span><i />任务可追踪</span>
        </div>
      </div>

      <div class="bridge-art" aria-hidden="true">
        <div class="cloud-node baidu-node">
          <span>百</span>
          <small>BAIDU</small>
        </div>
        <div class="bridge-line">
          <i /><i /><i />
          <b>→</b>
        </div>
        <div class="cloud-node quark-node">
          <span>夸</span>
          <small>QUARK</small>
        </div>
        <div class="orbit orbit-a" />
        <div class="orbit orbit-b" />
      </div>
    </section>

    <div v-if="!availableDirections.baidu || !availableDirections.quark" class="setup-warning card">
      <span class="warning-mark">!</span>
      <div>
        <strong>还缺一个网盘账号</strong>
        <p>跨盘同步需要同时连接百度网盘和夸克网盘。</p>
      </div>
      <button class="btn btn-primary" @click="store.page = 'accounts'">去添加账号</button>
    </div>

    <section class="workbench">
      <article class="account-card source-card card">
        <header class="account-head">
          <div>
            <span class="mono step">01 · SOURCE</span>
            <h4 class="display">从哪个网盘出发</h4>
          </div>
          <span v-if="sourceMeta" class="provider-seal" :class="sourceMeta.tone">{{ sourceMeta.short }}</span>
        </header>

        <label class="field-label">源网盘账号</label>
        <select v-model="sourceAccountId" class="select full">
          <option v-for="account in sourceOptions" :key="account.id" :value="account.id">
            {{ account.label }} · {{ providerMeta[account.provider]?.name }}
          </option>
        </select>

        <label class="field-label">要同步的文件或文件夹</label>
        <div class="path-field">
          <div class="path-icon">{{ sourcePath === '/' ? '⌂' : '▣' }}</div>
          <div class="path-copy">
            <strong>{{ sourceName }}</strong>
            <small>{{ sourcePath }}</small>
          </div>
          <button class="browse" :disabled="!sourceAccount" @click="openPicker('source')">浏览</button>
        </div>

        <div class="source-tip">
          <span>可以选文件夹，也可以直接选一个文件。</span>
          <small>根目录不能直接同步，避免误搬整个网盘。</small>
        </div>
      </article>

      <div class="direction-switch">
        <button title="交换同步方向" :disabled="!sourceAccount || !destinationAccount" @click="swapDirection">
          <span>⇄</span>
          <small>交换</small>
        </button>
      </div>

      <article class="account-card destination-card card">
        <header class="account-head">
          <div>
            <span class="mono step">02 · DESTINATION</span>
            <h4 class="display">落到哪个网盘</h4>
          </div>
          <span v-if="destinationMeta" class="provider-seal" :class="destinationMeta.tone">{{ destinationMeta.short }}</span>
        </header>

        <label class="field-label">目标网盘账号</label>
        <select v-model="destinationAccountId" class="select full" :disabled="!destinationOptions.length">
          <option v-if="!destinationOptions.length" value="">请先添加另一种网盘账号</option>
          <option v-for="account in destinationOptions" :key="account.id" :value="account.id">
            {{ account.label }} · {{ providerMeta[account.provider]?.name }}
          </option>
        </select>

        <label class="field-label">写入目录</label>
        <div class="path-field destination-path">
          <div class="path-icon">⌂</div>
          <div class="path-copy">
            <strong>{{ destinationName.split('/').filter(Boolean).pop() || '根目录' }}</strong>
            <small>{{ destinationName }}</small>
          </div>
          <button class="browse" :disabled="!destinationAccount" @click="openPicker('destination')">浏览</button>
        </div>

        <div class="destination-tip">
          <span>会自动复用同名文件夹。</span>
          <small>目标目录不存在时会自动逐级创建。</small>
        </div>
      </article>
    </section>

    <section class="launch-panel card">
      <div class="launch-route">
        <span class="route-provider" :class="sourceMeta?.tone">
          {{ sourceMeta?.name || '源网盘' }}
        </span>
        <div class="route-name">
          <strong>{{ sourceName }}</strong>
          <small>同步到</small>
          <strong>{{ destinationName }}</strong>
        </div>
        <span class="route-provider" :class="destinationMeta?.tone">
          {{ destinationMeta?.name || '目标网盘' }}
        </span>
      </div>
      <div class="launch-action">
        <div class="launch-note">
          <span class="pulse-dot" />
          将创建一个源盘临时分享，再转存到目标账号
        </div>
        <button class="btn btn-primary launch-btn" :disabled="!canSubmit" @click="startSync">
          {{ submitting ? '正在创建任务…' : '开始跨盘同步' }}
        </button>
      </div>
    </section>

    <section class="recent-section">
      <header class="section-head">
        <div>
          <span class="mono">RECENT BRIDGES</span>
          <h4 class="display">最近同步</h4>
        </div>
        <span class="muted tiny">{{ tasks.length }} 个任务</span>
      </header>

      <div v-if="!tasks.length" class="empty card">
        <span>⇄</span>
        <strong>还没有跨盘记录</strong>
        <p>完成第一次同步后，进度和结果会保留在这里。</p>
      </div>

      <div v-else class="task-stack">
        <article v-for="(task, index) in tasks.slice(0, 8)" :key="task.id" class="mini-task card" :style="{ '--i': index }">
          <div class="task-status" :class="statusMeta(task).cls">
            <span />
            {{ statusMeta(task).label }}
          </div>
          <div class="task-copy">
            <strong>{{ task.title }}</strong>
            <small>{{ task.logs?.[task.logs.length - 1] || '等待日志…' }}</small>
          </div>
          <div class="task-time">
            <strong>{{ task.progress || 0 }}%</strong>
            <small>{{ fmtTime(task.createdAt) }}</small>
          </div>
          <div class="task-progress">
            <i :style="{ width: `${task.progress || 0}%` }" />
          </div>
        </article>
      </div>
    </section>

    <CloudPathPickerModal
      v-model="pickerOpen"
      :account="pickerMode === 'destination' ? destinationAccount : sourceAccount"
      :mode="pickerMode === 'destination' ? 'destination' : 'source'"
      :title="pickerMode === 'destination' ? '选择目标目录' : '选择要同步的内容'"
      :description="pickerMode === 'destination'
        ? '文件会写入这个目录；同名文件默认跳过。'
        : '可以进入文件夹后选择整个目录，也可以直接点选一个文件。'"
      @select="choosePath"
    />
  </div>
</template>

<style scoped>
.cloud-sync { display: grid; gap: 22px; }
.sync-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(330px, .9fr);
  gap: 24px;
  min-height: 260px;
  padding: 34px 36px;
  overflow: hidden;
  color: #f7f0e5;
  border-color: rgba(255,255,255,.08);
  background:
    radial-gradient(520px 300px at 85% 30%, rgba(15,118,110,.33), transparent 68%),
    radial-gradient(360px 240px at 0% 100%, rgba(239,84,56,.2), transparent 70%),
    linear-gradient(128deg, #101a23, #16252a 58%, #142b2a);
}
.sync-hero::before {
  content: "";
  position: absolute;
  width: 500px;
  height: 500px;
  right: -250px;
  top: -280px;
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 50%;
  box-shadow: 0 0 0 48px rgba(255,255,255,.018), 0 0 0 96px rgba(255,255,255,.012);
}
.hero-copy { position: relative; z-index: 2; align-self: center; }
.hero-kicker { color: #8fd7cb; font-size: 8px; letter-spacing: .26em; }
.hero-copy h3 { max-width: 560px; margin: 13px 0 14px; font-size: clamp(32px, 4vw, 54px); line-height: 1.1; }
.hero-copy p { max-width: 570px; margin: 0; color: rgba(247,240,229,.64); font-size: 13px; line-height: 1.8; }
.hero-badges { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 22px; }
.hero-badges span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 999px;
  background: rgba(255,255,255,.055);
  color: rgba(247,240,229,.75);
  font-size: 9px;
}
.hero-badges i { width: 5px; height: 5px; border-radius: 50%; background: #7fd2c4; box-shadow: 0 0 10px #7fd2c4; }
.bridge-art {
  position: relative;
  z-index: 1;
  min-height: 195px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 17px;
}
.cloud-node {
  position: relative;
  z-index: 2;
  width: 108px;
  height: 108px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 4px;
  border-radius: 32px;
  box-shadow: 0 24px 54px rgba(0,0,0,.22);
}
.cloud-node span { font-family: var(--display); font-size: 38px; line-height: 1; }
.cloud-node small { font-family: var(--mono); font-size: 7px; letter-spacing: .2em; opacity: .5; }
.baidu-node {
  color: #f5f8ff;
  background: linear-gradient(145deg, #4d79ed, #2149b8);
  transform: rotate(-4deg);
}
.quark-node {
  color: #fff8f0;
  background: linear-gradient(145deg, #ff8a3d, #dd4f16);
  transform: rotate(4deg);
}
.bridge-line {
  position: relative;
  width: 112px;
  height: 2px;
  background: linear-gradient(90deg, rgba(127,210,196,.18), #7fd2c4, rgba(127,210,196,.18));
  box-shadow: 0 0 22px rgba(127,210,196,.38);
}
.bridge-line i {
  position: absolute;
  top: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d9fff8;
  box-shadow: 0 0 13px #7fd2c4;
  animation: packet 2.8s linear infinite;
}
.bridge-line i:nth-child(2) { animation-delay: .9s; }
.bridge-line i:nth-child(3) { animation-delay: 1.8s; }
.bridge-line b {
  position: absolute;
  right: -5px;
  top: -14px;
  color: #a7e5da;
  font-size: 21px;
  font-weight: 400;
}
.orbit { position: absolute; border: 1px solid rgba(255,255,255,.08); border-radius: 50%; }
.orbit-a { width: 210px; height: 210px; }
.orbit-b { width: 280px; height: 280px; border-style: dashed; opacity: .55; animation: orbit 24s linear infinite; }
.setup-warning {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 16px 18px;
  border-color: rgba(217,154,50,.24);
  background: linear-gradient(90deg, rgba(217,154,50,.1), var(--card-a));
}
.warning-mark {
  width: 37px;
  height: 37px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--gold-soft);
  color: var(--gold);
  font-family: var(--display);
  font-size: 20px;
}
.setup-warning > div { flex: 1; display: grid; gap: 3px; }
.setup-warning strong { font-size: 13px; }
.setup-warning p { margin: 0; color: var(--muted); font-size: 10px; }
.workbench {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 78px minmax(0, 1fr);
  align-items: center;
  gap: 0;
}
.account-card { position: relative; display: grid; gap: 11px; padding: 24px; }
.source-card { border-radius: 24px 12px 12px 24px; }
.destination-card { border-radius: 12px 24px 24px 12px; }
.source-card::before, .destination-card::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: radial-gradient(220px 140px at 100% 0%, var(--teal-soft), transparent 66%);
}
.destination-card::before { background: radial-gradient(220px 140px at 0% 0%, var(--coral-soft), transparent 66%); }
.account-head { position: relative; display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 4px; }
.step { color: var(--muted); font-size: 7px; letter-spacing: .2em; }
.account-head h4 { margin: 7px 0 0; font-size: 23px; }
.provider-seal {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  color: #fff;
  font-family: var(--display);
  font-size: 19px;
}
.provider-seal.blue { background: linear-gradient(145deg, #4d79ed, #2149b8); box-shadow: 0 10px 24px rgba(62,101,214,.22); }
.provider-seal.orange { background: linear-gradient(145deg, #ff8a3d, #dd4f16); box-shadow: 0 10px 24px rgba(227,91,34,.22); }
.path-field {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 62px;
  padding: 9px 9px 9px 11px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--field);
}
.destination-path { background: rgba(239,84,56,.035); }
.path-icon {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--teal-soft);
  color: var(--teal);
  font-size: 16px;
}
.destination-path .path-icon { background: var(--coral-soft); color: var(--coral); }
.path-copy { flex: 1; min-width: 0; display: grid; gap: 3px; }
.path-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.path-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-family: var(--mono); font-size: 9px; }
.browse {
  flex: 0 0 auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--card-a);
  color: var(--ink-2);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: .2s;
}
.browse:hover { border-color: rgba(16,24,34,.24); transform: translateY(-1px); }
.browse:disabled { opacity: .4; cursor: not-allowed; transform: none; }
.source-tip, .destination-tip { display: grid; gap: 3px; padding: 9px 11px; border-radius: 12px; background: var(--ink-soft); }
.source-tip span, .destination-tip span { font-size: 9px; color: var(--ink-2); }
.source-tip small, .destination-tip small { color: var(--muted); font-size: 8px; }
.direction-switch { position: relative; z-index: 3; display: grid; justify-items: center; gap: 5px; }
.direction-switch::before {
  content: "";
  position: absolute;
  top: 22px;
  left: -20px;
  right: -20px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--line), transparent);
}
.direction-switch button {
  position: relative;
  z-index: 1;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 1px;
  border: 5px solid var(--paper);
  border-radius: 50%;
  background: var(--ink);
  color: #fff;
  box-shadow: 0 12px 28px rgba(16,24,34,.17);
  cursor: pointer;
  transition: transform .25s, background .25s;
}
.direction-switch button:hover { transform: rotate(180deg); background: var(--teal); }
.direction-switch button:disabled { opacity: .35; cursor: not-allowed; transform: none; }
.direction-switch span { font-size: 18px; line-height: 1; }
.direction-switch small { font-size: 7px; }
.launch-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 17px 18px;
  background:
    linear-gradient(90deg, rgba(15,118,110,.06), transparent 45%),
    var(--card-a);
}
.launch-route { display: flex; align-items: center; gap: 13px; min-width: 0; }
.route-provider { flex: 0 0 auto; padding: 8px 11px; border-radius: 999px; font-size: 9px; font-weight: 800; }
.route-provider.blue { background: rgba(62,101,214,.11); color: #315dc7; }
.route-provider.orange { background: rgba(227,91,34,.11); color: #c94d1a; }
.route-name { min-width: 0; display: flex; align-items: center; gap: 8px; color: var(--muted); }
.route-name strong { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-size: 11px; }
.route-name small { font-size: 8px; }
.launch-action { display: flex; align-items: center; gap: 16px; }
.launch-note { display: flex; align-items: center; gap: 7px; max-width: 230px; color: var(--muted); font-size: 9px; line-height: 1.5; }
.pulse-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--teal); box-shadow: 0 0 0 0 rgba(15,118,110,.4); animation: pulse 2s infinite; }
.launch-btn { min-width: 150px; }
.recent-section { display: grid; gap: 13px; }
.section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.section-head .mono { color: var(--coral); font-size: 7px; letter-spacing: .22em; }
.section-head h4 { margin: 6px 0 0; font-size: 25px; }
.empty { display: grid; justify-items: center; gap: 7px; padding: 42px 20px; text-align: center; }
.empty > span { font-size: 34px; color: rgba(16,24,34,.14); }
.empty strong { font-size: 14px; }
.empty p { margin: 0; color: var(--muted); font-size: 11px; }
.task-stack { display: grid; gap: 9px; }
.mini-task {
  position: relative;
  display: grid;
  grid-template-columns: 82px minmax(0,1fr) auto;
  align-items: center;
  gap: 13px;
  padding: 14px 16px 18px;
  overflow: hidden;
  opacity: 0;
  animation: reveal .45s cubic-bezier(.2,.8,.2,1) forwards;
  animation-delay: calc(var(--i) * 40ms);
}
.task-status { display: flex; align-items: center; gap: 6px; font-size: 9px; font-weight: 800; }
.task-status span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.task-status.teal { color: var(--teal); }
.task-status.gold { color: var(--gold); }
.task-status.coral { color: var(--coral); }
.task-status.muted { color: var(--muted); }
.task-copy { min-width: 0; display: grid; gap: 3px; }
.task-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.task-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 9px; }
.task-time { display: grid; justify-items: end; gap: 3px; }
.task-time strong { color: var(--teal); font-family: var(--mono); font-size: 10px; }
.task-time small { color: var(--muted); font-size: 8px; }
.task-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(16,24,34,.04); }
.task-progress i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--teal), var(--gold)); transition: width .6s ease; }
@keyframes packet {
  0% { left: 0; opacity: 0; }
  12% { opacity: 1; }
  88% { opacity: 1; }
  100% { left: calc(100% - 8px); opacity: 0; }
}
@keyframes orbit { to { transform: rotate(360deg); } }
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(15,118,110,.35); }
  70% { box-shadow: 0 0 0 7px rgba(15,118,110,0); }
  100% { box-shadow: 0 0 0 0 rgba(15,118,110,0); }
}
@media (max-width: 1060px) {
  .sync-hero { grid-template-columns: 1fr; }
  .bridge-art { min-height: 165px; }
  .workbench { grid-template-columns: 1fr; gap: 12px; }
  .source-card, .destination-card { border-radius: 22px; }
  .direction-switch::before { display: none; }
  .direction-switch button { border-width: 4px; transform: rotate(90deg); }
  .direction-switch button:hover { transform: rotate(270deg); }
  .sources, .source-card { order: 0; }
}
@media (max-width: 760px) {
  .sync-hero { padding: 26px 21px; }
  .hero-copy h3 { font-size: 34px; }
  .bridge-art { transform: scale(.9); margin: -12px 0; }
  .launch-panel { align-items: stretch; flex-direction: column; }
  .launch-action { align-items: stretch; flex-direction: column; }
  .launch-note { max-width: none; }
  .launch-btn { width: 100%; }
  .launch-route { align-items: flex-start; flex-wrap: wrap; }
  .route-name { width: 100%; order: 3; flex-direction: column; align-items: flex-start; }
  .mini-task { grid-template-columns: 1fr auto; }
  .task-status { grid-column: 1 / -1; }
}
</style>
