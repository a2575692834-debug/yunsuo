<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api.js'
import { notify } from '../toast.js'
import { fmtTime } from '../format.js'
import { store, setSession } from '../store.js'

const items = ref([])
const total = ref(0)
const pages = ref(1)
const page = ref(1)
const q = ref('')
const provider = ref('')
const loading = ref(false)
const publicSaving = ref(false)
let searchTimer = null

const providerMeta = {
  baidu: { label: '百度网盘', short: '百', cls: 'teal' },
  quark: { label: '夸克网盘', short: '夸', cls: 'blue' },
  xunlei: { label: '迅雷网盘', short: '迅', cls: 'gold' },
  demo: { label: '演示空间', short: '演', cls: 'coral' }
}

const providerFilters = [
  { value: '', label: '全部' },
  { value: 'baidu', label: '百度' },
  { value: 'quark', label: '夸克' },
  { value: 'xunlei', label: '迅雷' },
  { value: 'demo', label: '演示' }
]

const providerCount = computed(() => new Set(items.value.map((item) => item.provider).filter(Boolean)).size)
const publicEnabled = computed(() => !!store.user?.publicTransfers)

async function loadResources() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      q: q.value.trim(),
      provider: provider.value,
      page: String(page.value),
      pageSize: '12'
    })
    const data = await api.get(`/public/resources?${params}`)
    items.value = data.items
    total.value = data.total
    pages.value = data.pages
    if (page.value > data.pages) {
      page.value = data.pages
      return loadResources()
    }
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    loading.value = false
  }
}

function queueSearch() {
  clearTimeout(searchTimer)
  page.value = 1
  searchTimer = setTimeout(loadResources, 260)
}

function chooseProvider(value) {
  provider.value = value
}

function changePage(next) {
  if (next < 1 || next > pages.value || next === page.value || loading.value) return
  page.value = next
  loadResources()
}

async function copy(text, label = '内容') {
  if (!text) return notify('没有可复制的内容', 'error')
  try {
    await navigator.clipboard.writeText(text)
    notify(`${label}已复制`, 'success')
  } catch {
    notify('复制失败，请手动选择文本', 'error')
  }
}

function shareCopy(item) {
  return [
    item.title || '未命名资源',
    `链接: ${item.shareUrl}`,
    item.sharePasscode ? `提取码: ${item.sharePasscode}` : ''
  ].filter(Boolean).join('\n')
}

function expiryLabel(expires) {
  if (expires === null || expires === undefined) return '未设置'
  return Number(expires) > 0 ? `${expires} 天` : '永久有效'
}

async function togglePublic() {
  if (publicSaving.value) return
  publicSaving.value = true
  const next = !publicEnabled.value
  try {
    const data = await api.patch('/auth/privacy', { publicTransfers: next })
    setSession(store.token, data.user)
    notify(next ? '已开启，你的分享会出现在公开资源库' : '已关闭，你的分享已从公开资源库隐藏', 'success')
    page.value = 1
    await loadResources()
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    publicSaving.value = false
  }
}

watch(q, queueSearch)
watch(provider, queueSearch)
onMounted(loadResources)
</script>

<template>
  <div class="public-page">
    <section class="public-hero">
      <span class="hero-grid" />
      <span class="hero-ring ring-a" />
      <span class="hero-ring ring-b" />
      <div class="hero-copy">
        <div class="public-kicker mono"><i /> PUBLIC RESOURCE LIBRARY</div>
        <h2 class="display">公开资源，<br /><em>去发现。</em></h2>
        <p>这里汇总用户已经生成的公开分享链接。搜索资源、复制文案，或直接打开分享页面。</p>
      </div>
      <div class="hero-side">
        <div class="hero-stats">
          <div>
            <strong class="display">{{ total }}</strong>
            <span class="mono">RESOURCES</span>
          </div>
          <div>
            <strong class="display">{{ providerCount }}</strong>
            <span class="mono">PROVIDERS</span>
          </div>
        </div>
        <button
          class="public-toggle"
          :class="{ on: publicEnabled }"
          :aria-pressed="publicEnabled"
          :disabled="publicSaving"
          @click="togglePublic"
        >
          <span class="toggle-track"><i /></span>
          <span class="toggle-copy">
            <small class="mono">MY PUBLIC SHARING</small>
            <strong>{{ publicSaving ? '保存中…' : publicEnabled ? '我的分享已公开' : '公开我的分享' }}</strong>
            <em>{{ publicEnabled ? '关闭后立即从资源库隐藏' : '开启后会出现在公开资源库' }}</em>
          </span>
        </button>
      </div>
      <div class="hero-note mono">LIVE PUBLIC INDEX · {{ total }} LINKS</div>
    </section>

    <section class="discover card">
      <header class="discover-head">
        <div>
          <div class="eyebrow">SEARCH THE CLOUD</div>
          <h3 class="display">公开资源库</h3>
          <p>只展示已经生成的公开分享链接，不展示账号 Cookie 和保存路径。</p>
        </div>
        <label class="hero-search">
          <span>⌕</span>
          <input v-model="q" placeholder="搜索资源名称、分享链接、提取码或发布者" />
          <button v-if="q" @click="q = ''">×</button>
        </label>
      </header>

      <div class="provider-tabs">
        <button
          v-for="filter in providerFilters"
          :key="filter.value"
          :class="{ active: provider === filter.value }"
          @click="chooseProvider(filter.value)"
        >
          {{ filter.label }}
        </button>
        <span class="result-count mono">{{ total }} RESULTS</span>
      </div>

      <div v-if="loading" class="loading-state">
        <i />
        <span>正在整理公开资源…</span>
      </div>

      <div v-else-if="!items.length" class="empty-state">
        <span>⌕</span>
        <strong>还没有找到公开资源</strong>
        <p>尝试更换关键词，或等待更多分享链接进入公开资源库。</p>
      </div>

      <div v-else class="resource-grid">
        <article
          v-for="(item, i) in items"
          :key="item.id"
          class="resource-card"
          :class="providerMeta[item.provider]?.cls || 'blue'"
          :style="{ '--i': i }"
        >
          <header class="resource-head">
            <span class="provider-mark">
              {{ providerMeta[item.provider]?.short || '云' }}
            </span>
            <div class="provider-copy">
              <strong>{{ providerMeta[item.provider]?.label || item.provider || '未知网盘' }}</strong>
              <span>
                @{{ item.username }}
                <b v-if="item.username === store.user?.username">我的分享</b>
              </span>
            </div>
            <span class="expiry-tag">{{ expiryLabel(item.shareExpires) }}</span>
          </header>

          <h4 :title="item.title">{{ item.title || '未命名资源' }}</h4>

          <div class="share-link">
            <span class="mono">SHARE URL</span>
            <a :href="item.shareUrl" target="_blank" rel="noreferrer">{{ item.shareUrl }}</a>
          </div>

          <div class="resource-meta">
            <span>
              <small>提取码</small>
              <b class="mono">{{ item.sharePasscode || '无' }}</b>
            </span>
            <span>
              <small>发布时间</small>
              <b>{{ fmtTime(item.createdAt) }}</b>
            </span>
          </div>

          <footer class="resource-actions">
            <button class="resource-btn primary" @click="copy(shareCopy(item), '分享文案')">复制文案</button>
            <button class="resource-btn" @click="copy(item.shareUrl, '分享链接')">复制链接</button>
            <a :href="item.shareUrl" target="_blank" rel="noreferrer">打开分享 ↗</a>
          </footer>

          <a
            v-if="item.sourceUrl"
            class="source-link"
            :href="item.sourceUrl"
            target="_blank"
            rel="noreferrer"
          >
            原始分享 ↗
            <span v-if="item.sourceCode" class="mono">提取码 {{ item.sourceCode }}</span>
          </a>
        </article>
      </div>

      <div v-if="pages > 1" class="pager">
        <span class="mono">PAGE {{ page }} / {{ pages }}</span>
        <div>
          <button class="btn btn-ghost mini" :disabled="page <= 1" @click="changePage(page - 1)">← 上一页</button>
          <button class="btn btn-ghost mini" :disabled="page >= pages" @click="changePage(page + 1)">下一页 →</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.public-page { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; min-width: 0; }
.public-hero {
  position: relative;
  min-height: 250px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 30px;
  padding: 34px 38px 32px;
  border-radius: 27px;
  color: #f4efe6;
  overflow: hidden;
  background:
    radial-gradient(420px 260px at 82% 18%, rgba(36,165,150,.23), transparent 68%),
    radial-gradient(360px 220px at 58% 110%, rgba(217,154,50,.16), transparent 70%),
    linear-gradient(135deg, #10232a, #101820 62%);
  box-shadow: 0 28px 75px rgba(16,35,42,.2);
}
.hero-grid {
  position: absolute;
  inset: 0;
  opacity: .32;
  background-image:
    linear-gradient(rgba(244,239,230,.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(244,239,230,.045) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(90deg, #000, transparent 78%);
}
.hero-ring { position: absolute; border: 1px solid rgba(244,239,230,.09); border-radius: 50%; }
.ring-a { width: 290px; height: 290px; right: -74px; top: -168px; box-shadow: 0 0 0 34px rgba(244,239,230,.018); }
.ring-b { width: 160px; height: 160px; right: 72px; top: -82px; border-style: dashed; border-color: rgba(217,154,50,.22); animation: spin-slow 34s linear infinite; }
.hero-copy, .hero-side, .hero-note { position: relative; z-index: 2; }
.public-kicker { display: flex; align-items: center; gap: 8px; color: rgba(244,239,230,.47); font-size: 8px; letter-spacing: .24em; }
.public-kicker i { width: 7px; height: 7px; border-radius: 50%; background: #4cd2b7; box-shadow: 0 0 0 5px rgba(76,210,183,.11); }
.hero-copy h2 { margin: 16px 0 10px; font-size: clamp(37px, 4vw, 55px); line-height: 1.05; }
.hero-copy h2 em { color: #70ddc7; font-style: normal; }
.hero-copy p { margin: 0; max-width: 570px; color: rgba(244,239,230,.51); font-size: 12px; line-height: 1.8; }
.hero-side { display: grid; gap: 9px; align-self: end; }
.hero-stats { display: flex; gap: 10px; }
.hero-stats > div {
  min-width: 100px;
  padding: 14px;
  border: 1px solid rgba(244,239,230,.1);
  border-radius: 16px;
  background: rgba(7,16,20,.3);
  backdrop-filter: blur(10px);
}
.hero-stats strong { display: block; font-size: 30px; line-height: 1; }
.hero-stats span { display: block; margin-top: 7px; color: rgba(244,239,230,.38); font-size: 7px; letter-spacing: .15em; }
.public-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid rgba(244,239,230,.1);
  border-radius: 15px;
  background: rgba(7,16,20,.3);
  color: rgba(244,239,230,.72);
  text-align: left;
  cursor: pointer;
  backdrop-filter: blur(10px);
  transition: background .22s, border-color .22s, transform .22s;
}
.public-toggle:hover { background: rgba(7,16,20,.46); border-color: rgba(76,210,183,.25); transform: translateY(-1px); }
.public-toggle.on { border-color: rgba(76,210,183,.28); background: rgba(23,94,84,.26); }
.public-toggle:disabled { opacity: .6; cursor: wait; transform: none; }
.toggle-track {
  position: relative;
  width: 37px;
  height: 21px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgba(244,239,230,.14);
  transition: background .24s;
}
.toggle-track i {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #eee7dc;
  box-shadow: 0 2px 5px rgba(0,0,0,.2);
  transition: transform .24s cubic-bezier(.2,.8,.2,1), background .24s;
}
.public-toggle.on .toggle-track { background: #2eb79f; }
.public-toggle.on .toggle-track i { transform: translateX(16px); background: #f2fffb; }
.toggle-copy { flex: 1; min-width: 0; display: grid; gap: 2px; }
.toggle-copy small { color: rgba(244,239,230,.3); font-size: 6px; letter-spacing: .14em; }
.toggle-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; }
.toggle-copy em { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(244,239,230,.37); font-size: 7px; font-style: normal; }
.public-toggle.on .toggle-copy strong { color: #8aebd7; }
.hero-note {
  position: absolute;
  left: 38px;
  bottom: 17px;
  color: rgba(244,239,230,.24);
  font-size: 7px;
  letter-spacing: .15em;
}
.discover { min-width: 0; padding: 24px; overflow: visible; }
.discover::after { border-radius: inherit; }
.discover-head { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }
.discover-head h3 { margin: 6px 0 4px; font-size: 28px; }
.discover-head p { margin: 0; color: var(--muted); font-size: 10px; }
.hero-search {
  width: min(420px, 42vw);
  height: 43px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 13px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--field-bg);
  transition: border-color .2s, box-shadow .2s;
}
.hero-search:focus-within { border-color: rgba(15,118,110,.45); box-shadow: 0 0 0 4px rgba(15,118,110,.08); }
.hero-search > span { color: var(--muted); font-size: 18px; }
.hero-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 10px; }
.hero-search button { border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 17px; }
.provider-tabs { position: relative; z-index: 1; display: flex; align-items: center; gap: 6px; margin: 19px 0 15px; padding-bottom: 13px; border-bottom: 1px solid var(--line-soft); flex-wrap: wrap; }
.provider-tabs button {
  padding: 7px 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;
  transition: background .2s, color .2s, border-color .2s;
}
.provider-tabs button:hover { background: var(--ink-soft); color: var(--ink); }
.provider-tabs button.active { background: var(--ink); color: #fff; border-color: var(--ink); }
.result-count { margin-left: auto; color: var(--muted); font-size: 7px; letter-spacing: .14em; }
.resource-grid { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.resource-card {
  position: relative;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--line-soft);
  border-radius: 18px;
  background: linear-gradient(150deg, rgba(255,253,248,.82), rgba(250,246,238,.58));
  opacity: 0;
  animation: reveal .45s cubic-bezier(.2,.8,.2,1) forwards;
  animation-delay: calc(var(--i) * 38ms);
  transition: border-color .22s, box-shadow .22s, transform .22s;
}
.resource-card:hover {
  border-color: rgba(15,118,110,.19);
  box-shadow: 0 15px 38px rgba(24,42,38,.08);
  transform: translateY(-2px);
}
.resource-head { display: flex; align-items: center; gap: 9px; }
.provider-mark {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: var(--teal-soft);
  color: var(--teal);
  font-family: var(--display);
  font-size: 13px;
  font-weight: 800;
}
.resource-card.blue .provider-mark { background: var(--blue-soft); color: var(--blue); }
.resource-card.gold .provider-mark { background: var(--gold-soft); color: #9a6815; }
.resource-card.coral .provider-mark { background: var(--coral-soft); color: var(--coral); }
.provider-copy { flex: 1; min-width: 0; display: grid; gap: 2px; }
.provider-copy strong { font-size: 10px; }
.provider-copy span { color: var(--muted); font-size: 8px; }
.provider-copy b { margin-left: 5px; padding: 2px 5px; border-radius: 999px; background: var(--teal-soft); color: var(--teal); font-size: 7px; }
.expiry-tag { padding: 4px 7px; border-radius: 999px; background: var(--ink-soft); color: var(--muted); font-size: 7px; white-space: nowrap; }
.resource-card h4 { margin: 14px 0 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.share-link { display: grid; gap: 4px; padding: 9px 10px; border-radius: 11px; background: rgba(16,24,34,.035); }
.share-link span { color: var(--muted); font-size: 6px; letter-spacing: .15em; }
.share-link a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--blue); font-family: var(--mono); font-size: 8px; text-decoration: none; }
.resource-meta { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 10px; margin: 11px 0 13px; }
.resource-meta > span { min-width: 0; display: grid; gap: 3px; }
.resource-meta small { color: var(--muted); font-size: 7px; }
.resource-meta b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 8px; font-weight: 700; }
.resource-actions { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
.resource-btn, .resource-actions > a {
  min-height: 29px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 9px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--ghost-bg);
  color: var(--muted);
  font-size: 8px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition: color .18s, background .18s, border-color .18s;
}
.resource-btn:hover, .resource-actions > a:hover { color: var(--ink); background: var(--field-strong); border-color: var(--line); }
.resource-btn.primary { background: var(--teal-soft); color: var(--teal); border-color: transparent; }
.resource-actions > a { margin-left: auto; color: var(--teal); }
.source-link {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px dashed var(--line-soft);
  color: var(--muted);
  font-size: 7px;
  text-decoration: none;
}
.source-link span { color: var(--gold); }
.loading-state, .empty-state { min-height: 280px; display: grid; place-items: center; align-content: center; gap: 9px; text-align: center; color: var(--muted); }
.loading-state { display: flex; align-items: center; justify-content: center; font-size: 10px; }
.loading-state i { width: 14px; height: 14px; border: 2px solid var(--line); border-top-color: var(--teal); border-radius: 50%; animation: spin-slow .8s linear infinite; }
.empty-state > span { font-size: 36px; opacity: .24; }
.empty-state strong { color: var(--ink); font-size: 13px; }
.empty-state p { margin: 0; font-size: 10px; }
.pager { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; margin-top: 15px; }
.pager > span { color: var(--muted); font-size: 8px; letter-spacing: .15em; }
.pager > div { display: flex; gap: 6px; }
.mini { padding: 6px 11px; font-size: 9px; }
@media (max-width: 950px) {
  .resource-grid { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .public-hero { min-height: 285px; padding: 27px 23px 46px; grid-template-columns: 1fr; align-items: start; }
  .hero-side { align-self: end; }
  .hero-note { left: 23px; }
  .discover { padding: 18px; }
  .discover-head { flex-direction: column; align-items: stretch; }
  .hero-search { width: 100%; }
  .result-count { width: 100%; margin-left: 0; }
}
</style>
