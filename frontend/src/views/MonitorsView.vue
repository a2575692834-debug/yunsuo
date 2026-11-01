<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../api.js'
import { store } from '../store.js'
import { notify } from '../toast.js'
import { fmtTime } from '../format.js'
import FolderPickerModal from '../components/FolderPickerModal.vue'

const emit = defineEmits(['changed'])

const monitors = ref([])
const loading = ref(false)
const submitting = ref(false)
const parsing = ref(false)
const folderPickerOpen = ref(false)
const text = ref('')
const parsed = ref(null)
const form = ref({
  accountId: '',
  targetPath: defaultTargetPath(),
  intervalMinutes: 30,
  runMode: 'cloud',
  autoShare: false,
  unlimited: true,
  expires: 7,
  sharePasscode: '8888',
  passcodeEnabled: true
})
const targetPathTouched = ref(false)
const pollTimer = ref(null)
const generation = ref(0)

function defaultTargetPath() {
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

const INTERVAL_PRESETS = [
  { label: '15 分钟', value: 15 },
  { label: '30 分钟', value: 30 },
  { label: '1 小时', value: 60 },
  { label: '6 小时', value: 360 },
  { label: '24 小时', value: 1440 }
]

const accountOptions = computed(() => store.accounts)
const selectedAccount = computed(() => store.accounts.find((a) => a.id === form.value.accountId) || null)
const canSubmit = computed(() => parsed.value && form.value.accountId)

const samples = [
  { label: '百度示例', text: 'https://pan.baidu.com/s/1AbCdEf_123?pwd=qwer 提取码: qwer' },
  { label: '夸克示例', text: '链接: https://pan.quark.cn/s/8f3c2a91d7 提取码: 7k2x' },
  { label: '迅雷示例', text: 'https://pan.xunlei.com/s/VN9x2KpQr7 提取码: 3m8n' }
]

function providerName(id) {
  return providerMeta[id]?.label || id
}

function intervalLabel(minutes) {
  if (minutes >= 1440) return `${Math.round(minutes / 1440 * 10) / 10} 天`
  if (minutes >= 60) return `${Math.round(minutes / 60 * 10) / 10} 小时`
  return `${minutes} 分钟`
}

function statusMeta(monitor) {
  switch (monitor.status) {
    case 'checking': return { label: '检查中', cls: 'blue' }
    case 'syncing': return { label: '同步中', cls: 'coral' }
    case 'error': return { label: '异常', cls: 'coral' }
    case 'paused': return { label: '已暂停', cls: 'muted' }
    case 'idle': return monitor.changeCount
      ? { label: '已同步', cls: 'teal' }
      : { label: '监听中', cls: 'teal' }
    default: return { label: '等待首检', cls: 'muted' }
  }
}

function expiryLabel(expires) {
  return Number(expires) > 0 ? `${expires} 天` : '永久有效'
}

function useSample(sample) {
  text.value = sample.text
  parse()
}

async function parse() {
  const value = text.value.trim()
  if (!value) {
    parsed.value = null
    return notify('先粘贴一段分享链接', 'error')
  }
  parsing.value = true
  try {
    const data = await api.post('/parse', { text: value })
    const link = data.links[0]
    if (!link) return notify('没有识别到百度 / 夸克 / 迅雷分享链接', 'error')
    parsed.value = link
    form.value.accountId = store.accounts.find((account) => account.provider === link.provider)?.id || ''
    notify('已识别为 ' + link.providerName + ' 分享', 'success')
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    parsing.value = false
  }
}

function openFolderPicker() {
  if (!selectedAccount.value) return notify('请先选择网盘账号', 'error')
  folderPickerOpen.value = true
}

function chooseFolder(path) {
  form.value.targetPath = path
  targetPathTouched.value = true
}

function randomPasscode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  form.value.sharePasscode = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  form.value.passcodeEnabled = true
}

async function submit() {
  if (!parsed.value) return notify('先识别分享链接', 'error')
  if (!form.value.accountId) return notify('请选择用于转存的网盘账号', 'error')
  if (form.value.autoShare && form.value.passcodeEnabled && !/^[A-Z0-9]{4}$/.test(form.value.sharePasscode)) {
    return notify('请输入 4 位分享提取码,或选择无提取码', 'error')
  }
  submitting.value = true
  try {
    if (!targetPathTouched.value) form.value.targetPath = defaultTargetPath()
    const created = await api.post('/monitors', {
      text: text.value,
      accountId: form.value.accountId,
      targetPath: form.value.targetPath,
      intervalMinutes: Number(form.value.intervalMinutes),
      runMode: form.value.runMode,
      autoShare: form.value.autoShare,
      unlimited: form.value.unlimited,
      expires: form.value.expires,
      sharePasscode: form.value.autoShare && form.value.passcodeEnabled ? form.value.sharePasscode : ''
    })
    monitors.value.unshift(created)
    notify(
      form.value.runMode === 'local'
        ? '本地监控已创建，请保持桌面端运行以执行巡检'
        : '云端监控已创建，首次检查会立即同步到你的网盘',
      'success'
    )
    text.value = ''
    parsed.value = null
    emit('changed')
    await startPolling()
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    submitting.value = false
  }
}

async function load() {
  if (!store.token) return
  loading.value = true
  try {
    monitors.value = await api.get('/monitors')
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    loading.value = false
  }
}

async function patchMonitor(monitor, patch) {
  try {
    const updated = await api.patch(`/monitors/${monitor.id}`, patch)
    Object.assign(monitor, updated)
    notify('监控设置已更新', 'success')
  } catch (err) {
    notify(err.message, 'error')
  }
}

function toggleEnabled(monitor) {
  patchMonitor(monitor, { enabled: !monitor.enabled })
}

async function removeMonitor(monitor) {
  if (!confirm(`确定移除「${monitor.title || providerName(monitor.provider)}」的监控?`)) return
  try {
    await api.del(`/monitors/${monitor.id}`)
    monitors.value = monitors.value.filter((item) => item.id !== monitor.id)
    notify('监控已移除', 'success')
  } catch (err) {
    notify(err.message, 'error')
  }
}

function changeRunMode(monitor, runMode) {
  if (monitor.runMode === runMode) return
  patchMonitor(monitor, { runMode })
}

async function checkNow(monitor) {
  try {
    const result = await api.post(`/monitors/${monitor.id}/check`, {})
    monitor.status = 'checking'
    notify(
      monitor.runMode === 'local'
        ? (result.message || '本地检查已完成')
        : '已触发一次云端立即检查',
      'success'
    )
    await startPolling()
  } catch (err) {
    notify(err.message, 'error')
  }
}

async function syncNow(monitor) {
  try {
    await api.post(`/monitors/${monitor.id}/sync`, {})
    monitor.status = 'syncing'
    notify('已创建一次强制同步转存', 'success')
    await startPolling()
  } catch (err) {
    notify(err.message, 'error')
  }
}

function stopPolling() {
  generation.value++
  if (pollTimer.value) clearTimeout(pollTimer.value)
  pollTimer.value = null
}

async function startPolling() {
  const gen = ++generation.value
  const tick = async () => {
    if (gen !== generation.value) return
    try {
      const next = await api.get('/monitors')
      if (gen !== generation.value) return
      monitors.value = next
      const active = next.some((m) =>
        ['checking', 'syncing'].includes(m.status) ||
        (m.status === 'waiting' && m.nextCheckAt && m.nextCheckAt <= Date.now() + 20000)
      )
      if (active) {
        pollTimer.value = setTimeout(tick, 2500)
        return
      }
      pollTimer.value = null
    } catch {
      if (gen !== generation.value) return
      pollTimer.value = setTimeout(tick, 4000)
    }
  }
  tick()
}

onMounted(() => {
  load()
  if (store.accounts.length) form.value.accountId = ''
})
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="monitors">
    <section class="card builder">
      <div class="eyebrow">WATCH &amp; SYNC</div>
      <h3 class="display">新建链接监控</h3>
      <p class="muted">粘贴别人持续更新的分享链接。云端由服务器持续巡检；本地由桌面端驱动，关闭客户端后自动暂停。</p>

      <div class="run-mode" role="radiogroup" aria-label="监控运行方式">
        <button
          class="run-mode-option"
          :class="{ active: form.runMode === 'cloud' }"
          role="radio"
          :aria-checked="form.runMode === 'cloud'"
          @click="form.runMode = 'cloud'"
        >
          <span class="run-mode-icon">云</span>
          <span>
            <strong>云端监控</strong>
            <small>服务器 7×24 小时巡检，不依赖浏览器或桌面端</small>
          </span>
          <i />
        </button>
        <button
          class="run-mode-option"
          :class="{ active: form.runMode === 'local' }"
          role="radio"
          :aria-checked="form.runMode === 'local'"
          @click="form.runMode = 'local'"
        >
          <span class="run-mode-icon">本</span>
          <span>
            <strong>本地监控</strong>
            <small>由已登录的桌面端定时触发，关闭客户端后暂停</small>
          </span>
          <i />
        </button>
      </div>

      <div class="builder-grid">
        <div class="builder-input">
          <label class="field-label">分享链接 / 文案</label>
          <textarea
            v-model="text"
            class="textarea paste"
            placeholder="支持整段文案,自动识别百度 / 夸克 / 迅雷分享链接与提取码"
            @input="parsed = null"
          />
          <div class="samples">
            <span class="tiny muted">试一试</span>
            <button v-for="s in samples" :key="s.label" class="sample" @click="useSample(s)">{{ s.label }}</button>
          </div>
          <button class="btn btn-primary" :disabled="!text.trim() || parsing" @click="parse">
            {{ parsing ? '识别中…' : '识别链接' }}
          </button>
          <div v-if="parsed" class="link-chip" :class="providerMeta[parsed.provider]?.cls">
            <span class="provider-mark">{{ providerMeta[parsed.provider]?.mark }}</span>
            <div>
              <strong>{{ providerMeta[parsed.provider]?.label }}</strong>
              <span class="mono tiny">{{ parsed.key }}</span>
            </div>
            <span v-if="parsed.passcode" class="chip-code">提取码 {{ parsed.passcode }}</span>
          </div>
        </div>

        <div class="builder-settings">
          <label class="field-label">转存账号</label>
          <select v-model="form.accountId" class="select full" :disabled="!accountOptions.length">
            <option value="">请选择网盘账号</option>
            <option v-for="a in accountOptions" :key="a.id" :value="a.id" :disabled="parsed && a.provider !== parsed.provider">
              {{ a.label }} · {{ providerName(a.provider) }}
            </option>
          </select>
          <p v-if="parsed && form.accountId && selectedAccount && selectedAccount.provider !== parsed.provider" class="warn tiny">
            账号类型与链接不符,请选择 {{ parsed.providerName }} 账号
          </p>

          <label class="field-label">转存目录</label>
          <div class="folder-row">
            <input
              v-model="form.targetPath"
              class="input"
              placeholder="/转存/YYYY-MM-DD"
              @input="targetPathTouched = true"
            />
            <button class="btn btn-ghost mini" :disabled="!selectedAccount" @click="openFolderPicker">浏览</button>
          </div>

          <label class="field-label">检查间隔</label>
          <div class="interval-row">
            <button
              v-for="preset in INTERVAL_PRESETS"
              :key="preset.value"
              class="chip"
              :class="{ active: form.intervalMinutes === preset.value }"
              @click="form.intervalMinutes = preset.value"
            >{{ preset.label }}</button>
            <input v-model.number="form.intervalMinutes" type="number" min="5" max="1440" class="input mini-number" />
          </div>

          <div class="switch-row">
            <label class="switch">
              <input v-model="form.autoShare" type="checkbox" />
              <span>同步后额外分享（可选）</span>
            </label>
            <label v-if="form.autoShare" class="switch">
              <input v-model="form.unlimited" type="checkbox" />
              <span>永久有效</span>
            </label>
            <label v-if="form.autoShare" class="switch">
              <input v-model="form.passcodeEnabled" type="checkbox" :disabled="!form.autoShare" />
              <span>带提取码</span>
            </label>
          </div>

          <div v-if="form.autoShare && !form.unlimited" class="expiry-row">
            <label class="tiny muted">有效天数</label>
            <input v-model.number="form.expires" type="number" min="1" max="3650" class="input mini-number" />
          </div>
          <div v-if="form.autoShare && form.passcodeEnabled" class="expiry-row">
            <label class="tiny muted">提取码</label>
            <input v-model="form.sharePasscode" class="input code" maxlength="4" />
            <button class="btn btn-quiet mini" @click="randomPasscode">随机</button>
          </div>
        </div>
      </div>

      <div class="builder-actions">
        <button class="btn btn-primary" :disabled="!canSubmit || submitting" @click="submit">
          {{ submitting ? '创建中…' : '开始监控' }}
        </button>
      </div>
    </section>

    <section class="list-sec">
      <div class="sec-head">
        <div>
          <div class="eyebrow">MONITORED LINKS</div>
          <h3 class="display">我的监控</h3>
        </div>
        <span class="muted tiny">{{ monitors.length }} 个监控 · {{ monitors.filter(m => m.enabled).length }} 个运行中</span>
      </div>

      <div v-if="!loading && !monitors.length" class="empty card">
        <div class="empty-orb">◎</div>
        <h4 class="display">还没有监控任何链接</h4>
        <p>把别人持续更新的分享链接交给云梭，首次与后续变化都会同步到你的网盘。</p>
      </div>

      <div class="monitor-grid stagger">
        <article v-for="(m, i) in monitors" :key="m.id" class="monitor card" :style="{ '--i': i }">
          <div class="monitor-head">
            <span class="acc-mark" :class="providerMeta[m.provider]?.cls">{{ providerMeta[m.provider]?.mark }}</span>
            <div class="monitor-title">
              <strong>{{ m.title || providerName(m.provider) }}</strong>
              <span class="mono tiny">{{ m.url }}</span>
            </div>
            <span class="mode-tag" :class="{ local: m.runMode === 'local' }">
              {{ m.runMode === 'local' ? '本地' : '云端' }}
            </span>
            <span class="tag" :class="statusMeta(m).cls">
              <i class="dot" />{{ statusMeta(m).label }}
            </span>
          </div>

          <div class="monitor-meta">
            <div class="mm">
              <span class="tiny muted">账号</span>
              <strong>{{ m.accountLabel || providerName(m.provider) }}</strong>
            </div>
            <div class="mm">
              <span class="tiny muted">间隔</span>
              <strong>{{ intervalLabel(m.intervalMinutes) }}</strong>
            </div>
            <div class="mm">
              <span class="tiny muted">目录</span>
              <strong class="path">{{ m.targetPath }}</strong>
            </div>
            <div class="mm">
              <span class="tiny muted">上次同步</span>
              <strong>{{ m.lastChangeAt ? fmtTime(m.lastChangeAt) : '尚未同步' }}</strong>
            </div>
            <div class="mm">
              <span class="tiny muted">同步次数</span>
              <strong>{{ m.changeCount }}</strong>
            </div>
            <div class="mm">
              <span class="tiny muted">运行方式</span>
              <select class="mode-select" :value="m.runMode" @change="changeRunMode(m, $event.target.value)">
                <option value="cloud">云端 7×24</option>
                <option value="local">本地桌面端</option>
              </select>
            </div>
          </div>

          <div v-if="m.autoShare && m.lastShareUrl" class="monitor-share">
            <span class="tiny muted">本批分享</span>
            <a :href="m.lastShareUrl" target="_blank" rel="noopener" class="share-link">{{ m.lastShareUrl }}</a>
          </div>
          <div v-if="m.lastError" class="monitor-error">
            <span class="tiny">异常</span>
            <span>{{ m.lastError }}</span>
          </div>

          <div class="monitor-foot">
            <span class="tiny muted">
              下次检查 {{ m.nextCheckAt ? fmtTime(m.nextCheckAt) : '已暂停' }}
            </span>
            <div class="monitor-actions">
              <button class="btn btn-ghost mini" :disabled="['checking','syncing'].includes(m.status)" @click="checkNow(m)">检查</button>
              <button class="btn btn-ghost mini" :disabled="['checking','syncing'].includes(m.status)" @click="syncNow(m)">立即同步</button>
              <button class="btn btn-quiet mini" :class="{ on: m.enabled }" @click="toggleEnabled(m)">
                {{ m.enabled ? '暂停' : '恢复' }}
              </button>
              <button class="btn btn-quiet mini danger" @click="removeMonitor(m)">移除</button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <FolderPickerModal
      v-model="folderPickerOpen"
      :account="selectedAccount"
      @select="chooseFolder"
    />
  </div>
</template>

<style scoped>
.monitors { display: grid; gap: 30px; }
.builder { padding: 24px; }
.run-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px; }
.run-mode-option {
  position: relative;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 11px;
  border: 1px solid rgba(16,24,34,.11);
  border-radius: 17px;
  padding: 13px;
  background: rgba(255,255,255,.34);
  text-align: left;
  cursor: pointer;
  transition: border-color .22s, background .22s, transform .22s;
}
.run-mode-option:hover { transform: translateY(-1px); border-color: rgba(15,118,110,.28); }
.run-mode-option.active { border-color: rgba(15,118,110,.42); background: rgba(15,118,110,.075); box-shadow: inset 0 0 0 1px rgba(15,118,110,.08); }
.run-mode-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: rgba(16,24,34,.06);
  color: var(--muted);
  font-family: var(--display);
  font-size: 17px;
}
.run-mode-option.active .run-mode-icon { background: var(--teal); color: #fff; }
.run-mode-option > span:nth-child(2) { display: grid; gap: 3px; min-width: 0; }
.run-mode-option strong { font-size: 13px; }
.run-mode-option small { color: var(--muted); font-size: 10px; line-height: 1.5; }
.run-mode-option i {
  width: 12px;
  height: 12px;
  border: 1px solid rgba(16,24,34,.22);
  border-radius: 50%;
}
.run-mode-option.active i { border: 3px solid var(--teal); background: #fff; }
.builder-grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 26px; margin-top: 16px; }
.builder-input { display: grid; gap: 12px; align-content: start; }
.builder-settings { display: grid; gap: 10px; align-content: start; }
.field-label { font-size: 11px; letter-spacing: .14em; color: rgba(16,24,34,.55); font-weight: 700; }
.samples { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.sample { border: 1px dashed rgba(16,24,34,.2); background: transparent; border-radius: 999px; padding: 5px 12px; font-size: 11px; cursor: pointer; transition: .2s; }
.sample:hover { border-color: var(--coral); color: var(--coral); }
.link-chip { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 16px; background: rgba(15,118,110,.08); border: 1px solid rgba(15,118,110,.2); }
.link-chip.blue { background: rgba(67,86,201,.08); border-color: rgba(67,86,201,.2); }
.link-chip.gold { background: rgba(190,126,23,.08); border-color: rgba(190,126,23,.22); }
.provider-mark { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; background: var(--teal); color: #fff; font-weight: 800; }
.link-chip.blue .provider-mark { background: var(--blue); }
.link-chip.gold .provider-mark { background: var(--gold); }
.link-chip > div { display: grid; gap: 2px; flex: 1; }
.chip-code { font-size: 11px; color: var(--teal); font-weight: 700; }
.folder-row { display: flex; gap: 8px; }
.folder-row .input { flex: 1; }
.interval-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.chip { border: 1px solid rgba(16,24,34,.16); background: transparent; border-radius: 999px; padding: 6px 12px; font-size: 12px; cursor: pointer; transition: .2s; }
.chip.active { background: var(--coral); color: #fff; border-color: var(--coral); }
.mini-number { width: 84px; }
.switch-row { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 4px; }
.switch { display: flex; align-items: center; gap: 7px; font-size: 13px; cursor: pointer; }
.expiry-row { display: flex; align-items: center; gap: 10px; }
.expiry-row .input { width: 110px; }
.input.code { width: 96px; letter-spacing: .3em; text-transform: uppercase; }
.warn { color: var(--coral); }
.builder-actions { margin-top: 18px; display: flex; justify-content: flex-end; }
.monitor-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.monitor-head { display: flex; align-items: center; gap: 12px; }
.monitor-title { flex: 1; display: grid; gap: 2px; min-width: 0; }
.monitor-title strong { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.monitor-title .mono { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: rgba(16,24,34,.45); }
.monitor-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 10px; margin: 14px 0; }
.mm { display: grid; gap: 3px; }
.mm strong { font-size: 13px; }
.mm strong.path { font-size: 11px; word-break: break-all; }
.mode-tag { flex: 0 0 auto; padding: 5px 8px; border-radius: 999px; background: rgba(16,24,34,.055); color: var(--muted); font-size: 9px; font-weight: 800; }
.mode-tag.local { background: rgba(190,126,23,.12); color: #956716; }
.mode-select { width: 100%; min-width: 0; border: 0; outline: 0; padding: 0; background: transparent; color: var(--ink); font-size: 12px; font-weight: 700; cursor: pointer; }
.monitor-share { display: grid; gap: 4px; padding: 10px; border-radius: 14px; background: rgba(15,118,110,.07); margin-bottom: 10px; }
.share-link { font-size: 12px; color: var(--teal); word-break: break-all; }
.monitor-error { display: grid; gap: 4px; padding: 10px; border-radius: 14px; background: rgba(239,84,56,.08); color: var(--coral); margin-bottom: 10px; }
.monitor-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.monitor-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.btn-quiet.on { color: var(--gold); border-color: rgba(190,126,23,.4); }
@media (max-width: 820px) {
  .run-mode { grid-template-columns: 1fr; }
  .builder-grid { grid-template-columns: 1fr; }
  .monitor-grid { grid-template-columns: 1fr; }
  .monitor-meta { grid-template-columns: repeat(2, 1fr); }
}
</style>
