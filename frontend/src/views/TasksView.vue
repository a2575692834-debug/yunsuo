<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api.js'
import { notify } from '../toast.js'
import { fmtTime } from '../format.js'

const tasks = ref([])
const filter = ref('all')
const expanded = ref(new Set())
let timer = null

const filters = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '进行中' },
  { key: 'queued', label: '等待' },
  { key: 'done', label: '完成' },
  { key: 'error', label: '失败' }
]

const statusMeta = {
  queued: { label: '等待中', cls: 'gold' },
  running: { label: '进行中', cls: 'teal' },
  done: { label: '已完成', cls: 'teal' },
  error: { label: '失败', cls: 'coral' },
  canceled: { label: '已取消', cls: 'blue' }
}

const kindMeta = {
  transfer: { label: '转存', cls: 'coral' },
  share: { label: '分享', cls: 'blue' },
  search: { label: '搜索', cls: 'teal' }
}

const shown = computed(() => filter.value === 'all' ? tasks.value : tasks.value.filter((t) => t.status === filter.value))

async function load() {
  try { tasks.value = await api.get('/tasks') } catch { /* ignore polling errors */ }
}

function toggle(id) {
  const next = new Set(expanded.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expanded.value = next
}

async function cancel(task) {
  try {
    await api.post(`/tasks/${task.id}/cancel`)
    notify('已请求取消', 'success')
    load()
  } catch (err) { notify(err.message, 'error') }
}

async function remove(task) {
  try {
    await api.del(`/tasks/${task.id}`)
    tasks.value = tasks.value.filter((t) => t.id !== task.id)
  } catch (err) { notify(err.message, 'error') }
}

onMounted(() => {
  load()
  timer = setInterval(load, 1600)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="tasks">
    <section class="task-head card">
      <div class="filters">
        <button
          v-for="f in filters"
          :key="f.key"
          class="filter"
          :class="{ active: filter === f.key }"
          @click="filter = f.key"
        >
          {{ f.label }}
          <span>{{ f.key === 'all' ? tasks.length : tasks.filter(t => t.status === f.key).length }}</span>
        </button>
      </div>
      <span class="mono tiny muted">AUTO REFRESH · 1.6S</span>
    </section>

    <div v-if="!shown.length" class="empty card">
      <div class="empty-mark">≋</div>
      <h4 class="display">这里还很安静</h4>
      <p>发起一次智能转存后,任务会带着实时进度出现在这里。</p>
    </div>

    <div v-else class="task-list">
      <article v-for="(t, i) in shown" :key="t.id" class="task card" :style="{ '--i': i }">
        <div class="task-top">
          <span class="tag" :class="kindMeta[t.kind]?.cls || 'blue'">{{ kindMeta[t.kind]?.label || t.kind }}</span>
          <div class="task-title">
            <strong>{{ t.title }}</strong>
            <span class="mono tiny muted">{{ t.id }}</span>
          </div>
          <span class="tag" :class="statusMeta[t.status]?.cls || 'blue'">
            <i class="dot" :class="{ live: t.status === 'running' }" />{{ statusMeta[t.status]?.label || t.status }}
          </span>
        </div>

        <div class="progress-row">
          <div class="bar" :class="t.status === 'done' ? 'done' : t.status === 'error' ? 'error' : ''">
            <i :style="{ width: (t.progress || 0) + '%' }" />
          </div>
          <strong class="mono pct">{{ t.progress || 0 }}%</strong>
        </div>

        <div class="task-foot">
          <span class="last-log">{{ t.logs?.[t.logs.length - 1] || '等待日志…' }}</span>
          <div class="foot-actions">
            <span class="mono tiny muted">{{ fmtTime(t.createdAt) }}</span>
            <button class="btn btn-quiet mini" @click="toggle(t.id)">{{ expanded.has(t.id) ? '收起' : '日志' }}</button>
            <button v-if="['queued', 'running'].includes(t.status)" class="btn btn-quiet mini warn" @click="cancel(t)">取消</button>
            <button class="btn btn-quiet mini danger" @click="remove(t)">删除</button>
          </div>
        </div>

        <Transition name="fade">
          <div v-if="expanded.has(t.id)" class="logs">
            <div v-if="t.error" class="log error">{{ t.error }}</div>
            <div v-for="(line, idx) in t.logs" :key="idx" class="log mono">{{ line }}</div>
          </div>
        </Transition>
      </article>
    </div>
  </div>
</template>

<style scoped>
.tasks { display: grid; gap: 16px; }
.task-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 16px; }
.filters { display: flex; gap: 4px; flex-wrap: wrap; }
.filter {
  border: 0; background: transparent; color: var(--muted); font-size: 12px; font-weight: 650;
  padding: 8px 12px; border-radius: 999px; cursor: pointer; transition: .22s;
}
.filter span { margin-left: 5px; font-family: var(--mono); font-size: 9px; opacity: .55; }
.filter:hover { background: rgba(16,24,34,.05); color: var(--ink); }
.filter.active { background: var(--ink); color: #fff; }
.empty { display: grid; justify-items: center; gap: 9px; padding: 54px 20px; text-align: center; }
.empty-mark { font-size: 40px; color: rgba(16,24,34,.16); }
.empty h4 { margin: 0; font-size: 25px; }
.empty p { margin: 0; font-size: 13px; color: var(--muted); }
.task-list { display: grid; gap: 12px; }
.task { padding: 18px 20px; opacity: 0; animation: reveal .5s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: calc(var(--i) * 55ms); }
.task-top { display: flex; align-items: center; gap: 11px; }
.task-title { flex: 1; min-width: 0; display: grid; gap: 3px; }
.task-title strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-title span { font-size: 8px; }
.progress-row { display: flex; align-items: center; gap: 12px; margin: 16px 0 10px; }
.progress-row .bar { flex: 1; height: 9px; }
.pct { font-size: 11px; width: 42px; text-align: right; color: var(--teal); }
.task-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.last-log { flex: 1; min-width: 0; font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.foot-actions { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.mini { padding: 5px 8px; font-size: 10px; }
.danger { color: #b42318; }
.warn { color: #a16910; }
.logs { margin-top: 14px; padding: 12px; border-radius: 12px; background: rgba(16,24,34,.04); max-height: 230px; overflow: auto; }
.log { font-size: 10px; color: var(--muted); padding: 3px 0; border-bottom: 1px solid rgba(16,24,34,.04); }
.log:last-child { border-bottom: 0; }
.log.error { color: #b42318; }
@media (max-width: 720px) {
  .task-head { flex-direction: column; align-items: flex-start; }
  .task-foot { flex-direction: column; align-items: flex-start; }
  .foot-actions { flex-wrap: wrap; }
}
</style>
