<script setup>
import { computed, onMounted, reactive, watch } from 'vue'
import { store } from '../store.js'

const stats = computed(() => store.overview?.stats || { accounts: 0, done: 0, running: 0, shares: 0, resources: 0 })
const shown = reactive({ accounts: 0, done: 0, running: 0, shares: 0, resources: 0 })

const cards = [
  { key: 'accounts', label: '已连接网盘', sub: 'ACCOUNTS', accent: 'coral', mark: '◎' },
  { key: 'done', label: '完成转存', sub: 'COMPLETED', accent: 'teal', mark: '✓' },
  { key: 'running', label: '进行中', sub: 'RUNNING', accent: 'gold', mark: '≋' },
  { key: 'shares', label: '分享链接', sub: 'SHARES', accent: 'blue', mark: '↗' },
  { key: 'resources', label: '资源记录', sub: 'RESOURCES', accent: 'ink', mark: '▤' }
]

let raf = 0
function animate() {
  cancelAnimationFrame(raf)
  const start = performance.now()
  const from = { ...shown }
  const step = (now) => {
    const t = Math.min(1, (now - start) / 760)
    const ease = 1 - Math.pow(1 - t, 3)
    for (const key of Object.keys(shown)) {
      shown[key] = Math.round((from[key] || 0) + (stats.value[key] - (from[key] || 0)) * ease)
    }
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

watch(stats, animate, { deep: true })
onMounted(animate)

const tasks = computed(() => store.overview?.recentTasks || [])
const shares = computed(() => store.overview?.recentShares || [])

const kindMeta = {
  transfer: { label: '转存', cls: 'coral' },
  share: { label: '分享', cls: 'blue' },
  search: { label: '搜索', cls: 'teal' }
}
const statusMeta = {
  queued: { label: '等待', cls: 'gold' },
  running: { label: '进行中', cls: 'teal' },
  done: { label: '完成', cls: 'teal' },
  error: { label: '失败', cls: 'coral' },
  canceled: { label: '已取消', cls: 'blue' }
}
const providerMeta = {
  baidu: { label: '百度', cls: 'teal' },
  quark: { label: '夸克', cls: 'blue' },
  xunlei: { label: '迅雷', cls: 'gold' },
  demo: { label: '演示', cls: 'coral' }
}

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

function expiryLabel(expires) {
  return Number(expires) > 0 ? `${expires} 天` : '永久有效'
}
</script>

<template>
  <div class="dash">
    <section class="hero card">
      <div class="hero-copy">
        <div class="eyebrow">YOUR LINKS, YOUR CLOUD</div>
        <h2 class="display">{{ greeting }},{{ store.user?.username }}。<br />今天想搬点什么？</h2>
        <p>把一段分享文案交给云梭,它会识别链接、选择网盘、完成转存,再把新的分享递回你手里。</p>
        <div class="hero-actions">
          <button class="btn btn-primary" @click="store.page = 'transfer'">开始智能转存 →</button>
          <button class="btn btn-ghost" @click="store.page = 'accounts'">管理网盘账号</button>
        </div>
      </div>
      <div class="hero-visual">
        <div class="pulse-ring p1" />
        <div class="pulse-ring p2" />
        <div class="pulse-ring p3" />
        <div class="hero-core display">
          <span>{{ shown.done }}</span>
          <small class="mono">TRANSFERRED</small>
        </div>
        <span v-for="(a, i) in store.accounts.slice(0, 3)" :key="a.id" class="chip" :class="`c${i}`">
          {{ a.label }}
        </span>
      </div>
    </section>

    <section class="stats stagger">
      <article v-for="(c, i) in cards" :key="c.key" class="stat card" :class="c.accent" :style="{ '--i': i }">
        <div class="stat-top">
          <span class="stat-mark">{{ c.mark }}</span>
          <span class="mono tiny">{{ c.sub }}</span>
        </div>
        <strong class="stat-num display">{{ shown[c.key] }}</strong>
        <span class="stat-label">{{ c.label }}</span>
      </article>
    </section>

    <div class="columns">
      <section class="card panel">
        <header class="panel-head">
          <div>
            <div class="eyebrow">LIVE QUEUE</div>
            <h3 class="display">最近任务</h3>
          </div>
          <button class="btn btn-quiet" @click="store.page = 'tasks'">全部任务 →</button>
        </header>

        <div v-if="!tasks.length" class="empty">
          <span class="empty-mark">≋</span>
          <p>还没有任务。粘贴一个分享链接,让云梭跑起来。</p>
          <button class="btn btn-primary" @click="store.page = 'transfer'">去转存</button>
        </div>

        <div v-else class="task-list">
          <article v-for="(t, i) in tasks" :key="t.id" class="task" :style="{ '--i': i }">
            <div class="task-head">
              <span class="tag" :class="kindMeta[t.kind]?.cls || 'blue'">{{ kindMeta[t.kind]?.label || t.kind }}</span>
              <strong>{{ t.title }}</strong>
              <span class="tag" :class="statusMeta[t.status]?.cls || 'blue'">{{ statusMeta[t.status]?.label || t.status }}</span>
            </div>
            <div class="bar" :class="t.status === 'done' ? 'done' : t.status === 'error' ? 'error' : ''">
              <i :style="{ width: (t.progress || 0) + '%' }" />
            </div>
            <div class="task-foot mono">
              <span>{{ t.progress || 0 }}%</span>
              <span>{{ t.logs?.[t.logs.length - 1] || '等待中' }}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="card panel">
        <header class="panel-head">
          <div>
            <div class="eyebrow">SHARE LIBRARY</div>
            <h3 class="display">分享库</h3>
          </div>
          <button class="btn btn-quiet" @click="store.page = 'shares'">全部 →</button>
        </header>

        <div v-if="!shares.length" class="empty">
          <span class="empty-mark">↗</span>
          <p>转存完成后,新的分享链接会出现在这里。</p>
        </div>

        <div v-else class="share-list">
          <article v-for="(s, i) in shares" :key="s.id" class="share" :style="{ '--i': i }">
            <div class="share-top">
              <span class="tag" :class="providerMeta[s.provider]?.cls || 'blue'">{{ providerMeta[s.provider]?.label || s.provider }}</span>
              <strong>{{ s.title }}</strong>
            </div>
            <div class="share-url mono">{{ s.url }}</div>
            <div class="share-foot">
              <span v-if="s.passcode" class="tiny">提取码 {{ s.passcode }}</span>
              <span v-else class="tiny muted">无提取码</span>
              <span class="tiny" :class="{ 'permanent-label': !(Number(s.expires) > 0), muted: Number(s.expires) > 0 }">
                {{ expiryLabel(s.expires) }}
              </span>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dash { display: grid; gap: 20px; }
.hero {
  display: grid; grid-template-columns: 1.4fr .6fr; gap: 20px;
  padding: 34px 36px; min-height: 300px;
  background:
    radial-gradient(600px 300px at 90% 20%, rgba(15,118,110,.14), transparent 60%),
    linear-gradient(135deg, #fffdf8, #f6efe3);
}
.hero-copy { position: relative; z-index: 2; }
.hero-copy h2 { font-size: clamp(32px, 3.6vw, 52px); line-height: 1.16; margin: 16px 0 14px; }
.hero-copy p { max-width: 520px; color: var(--muted); line-height: 1.9; font-size: 14px; }
.hero-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
.permanent-label { color: #81550f; font-weight: 700; }
.hero-visual { position: relative; display: grid; place-items: center; min-height: 240px; }
.pulse-ring { position: absolute; border-radius: 50%; border: 1px solid rgba(239,84,56,.2); }
.p1 { width: 150px; height: 150px; animation: spin-slow 16s linear infinite; }
.p2 { width: 210px; height: 210px; border-color: rgba(15,118,110,.18); animation: spin-slow 22s linear infinite reverse; }
.p3 { width: 270px; height: 270px; border-style: dashed; border-color: rgba(217,154,50,.25); animation: spin-slow 30s linear infinite; }
.hero-core {
  position: relative; z-index: 2; width: 132px; height: 132px; border-radius: 50%;
  display: grid; place-items: center; align-content: center; gap: 4px;
  background: linear-gradient(145deg, var(--ink), #27364b);
  color: #fff; box-shadow: 0 24px 50px rgba(16,24,34,.28);
}
.hero-core span { font-size: 36px; line-height: 1; }
.hero-core small { font-size: 8px; letter-spacing: .18em; color: rgba(255,255,255,.45); }
.chip {
  position: absolute; padding: 6px 11px; border-radius: 999px; font-size: 10px; font-weight: 700;
  background: #fffdf8; border: 1px solid var(--line); box-shadow: 0 10px 24px rgba(48,34,18,.08);
  animation: float 6s ease-in-out infinite;
}
.c0 { top: 4%; left: 2%; color: var(--teal); }
.c1 { right: 0; top: 34%; color: var(--coral); animation-delay: -2s; }
.c2 { bottom: 8%; left: 16%; color: var(--gold); animation-delay: -4s; }
.stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; }
.stat { padding: 18px; display: grid; gap: 4px; background: linear-gradient(180deg, #fffdf8, #faf6ee); }
.stat-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.stat-mark {
  width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center;
  font-size: 15px; background: rgba(16,24,34,.06); color: var(--ink-2);
}
.stat.coral .stat-mark { background: var(--coral-soft); color: var(--coral); }
.stat.teal .stat-mark { background: var(--teal-soft); color: var(--teal); }
.stat.gold .stat-mark { background: var(--gold-soft); color: var(--gold); }
.stat.blue .stat-mark { background: var(--blue-soft); color: var(--blue); }
.stat-num { font-size: 38px; line-height: 1; margin-top: 6px; }
.stat-label { font-size: 12px; color: var(--muted); }
.columns { display: grid; grid-template-columns: 1.15fr .85fr; gap: 20px; }
.panel { padding: 22px; }
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
.panel-head h3 { margin: 6px 0 0; font-size: 24px; }
.empty { display: grid; justify-items: center; gap: 10px; padding: 40px 10px; text-align: center; color: var(--muted); }
.empty-mark { font-size: 34px; color: rgba(16,24,34,.18); }
.empty p { margin: 0 0 6px; font-size: 13px; }
.task-list { display: grid; gap: 14px; }
.task { padding: 14px; border: 1px solid var(--line-soft); border-radius: 16px; background: rgba(255,253,248,.6); opacity: 0; animation: reveal .55s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: calc(var(--i) * 65ms); }
.task-head { display: flex; align-items: center; gap: 8px; margin-bottom: 11px; }
.task-head strong { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 8px; font-size: 9px; color: var(--muted); }
.task-foot span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.share-list { display: grid; gap: 12px; }
.share { padding: 14px; border: 1px solid var(--line-soft); border-radius: 16px; background: rgba(255,253,248,.6); opacity: 0; animation: reveal .55s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: calc(var(--i) * 65ms); }
.share-top { display: flex; align-items: center; gap: 8px; }
.share-top strong { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.share-url { margin: 9px 0; font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.share-foot { display: flex; justify-content: space-between; }
@media (max-width: 1100px) {
  .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .columns { grid-template-columns: 1fr; }
}
@media (max-width: 820px) {
  .hero { grid-template-columns: 1fr; padding: 24px; }
  .hero-visual { min-height: 200px; }
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 520px) {
  .stats { grid-template-columns: 1fr 1fr; }
  .stat-num { font-size: 30px; }
  .hero-copy h2 { font-size: 30px; }
}
</style>
