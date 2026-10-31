<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../api.js'
import { notify } from '../toast.js'
import { fmtTime } from '../format.js'

const emit = defineEmits(['changed'])
const tab = ref('shares')
const shares = ref([])
const resources = ref([])
const loaded = ref(false)

const providerMeta = {
  baidu: { label: '百度', cls: 'teal' },
  quark: { label: '夸克', cls: 'blue' },
  xunlei: { label: '迅雷', cls: 'gold' },
  demo: { label: '演示', cls: 'coral' }
}

const list = computed(() => tab.value === 'shares' ? shares.value : resources.value)

function expiryLabel(expires) {
  return Number(expires) > 0 ? `${expires} 天` : '永久有效'
}

async function load() {
  try {
    const [s, r] = await Promise.all([api.get('/shares'), api.get('/resources')])
    shares.value = s
    resources.value = r
  } finally {
    loaded.value = true
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    notify('已复制到剪贴板', 'success')
  } catch {
    notify('复制失败,请手动选择文本', 'error')
  }
}

async function remove(share) {
  try {
    await api.del(`/shares/${share.id}`)
    shares.value = shares.value.filter((s) => s.id !== share.id)
    notify('分享记录已删除', 'success')
    emit('changed')
  } catch (err) {
    notify(err.message, 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="shares">
    <section class="bar-card card">
      <div class="tabs">
        <button class="tab" :class="{ active: tab === 'shares' }" @click="tab = 'shares'">
          分享链接 <span>{{ shares.length }}</span>
        </button>
        <button class="tab" :class="{ active: tab === 'resources' }" @click="tab = 'resources'">
          资源记录 <span>{{ resources.length }}</span>
        </button>
      </div>
      <span class="mono tiny muted">SHARE LIBRARY</span>
    </section>

    <div v-if="loaded && !list.length" class="empty card">
      <div class="empty-mark">{{ tab === 'shares' ? '↗' : '▤' }}</div>
      <h4 class="display">{{ tab === 'shares' ? '还没有分享链接' : '还没有资源记录' }}</h4>
      <p>{{ tab === 'shares' ? '转存时开启「自动分享」,新的链接会出现在这里。' : '每次转存都会留下一条资源记录。' }}</p>
    </div>

    <div v-else class="grid">
      <template v-if="tab === 'shares'">
        <article v-for="(s, i) in shares" :key="s.id" class="item card" :style="{ '--i': i }">
          <div class="item-top">
            <span class="tag" :class="providerMeta[s.provider]?.cls || 'blue'">{{ providerMeta[s.provider]?.label || s.provider }}</span>
            <span class="expiry-tag mono tiny" :class="{ permanent: !(Number(s.expires) > 0) }">
              {{ expiryLabel(s.expires) }}
            </span>
          </div>
          <h4 class="display">{{ s.title }}</h4>
          <div class="url mono">{{ s.url || '(空链接)' }}</div>
          <div class="passcode-row">
            <span class="tiny muted">提取码</span>
            <strong class="mono">{{ s.passcode || '无' }}</strong>
          </div>
          <div class="item-foot">
            <span class="tiny muted">{{ fmtTime(s.createdAt) }}</span>
            <div class="actions">
              <button class="btn btn-ghost mini" @click="copy(s.url)">复制链接</button>
              <button class="btn btn-quiet mini danger" @click="remove(s)">删除</button>
            </div>
          </div>
        </article>
      </template>

      <template v-else>
        <article v-for="(r, i) in resources" :key="r.id" class="item card" :style="{ '--i': i }">
          <div class="item-top">
            <span class="tag" :class="providerMeta[r.provider]?.cls || 'blue'">{{ providerMeta[r.provider]?.label || r.provider }}</span>
            <span class="mono tiny muted">SAVED</span>
          </div>
          <h4 class="display">{{ r.title }}</h4>
          <div class="url mono">{{ r.sourceUrl }}</div>
          <div class="saved-path">
            <span class="tiny muted">保存到</span>
            <strong class="mono">{{ r.savedPath || '/' }}</strong>
          </div>
          <div class="item-foot">
            <span class="tiny muted">{{ fmtTime(r.createdAt) }}</span>
            <button class="btn btn-quiet mini" @click="copy(r.sourceUrl)">复制源链接</button>
          </div>
        </article>
      </template>
    </div>
  </div>
</template>

<style scoped>
.shares { display: grid; gap: 16px; }
.bar-card { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; gap: 14px; }
.tabs { display: flex; gap: 4px; }
.tab {
  border: 0; background: transparent; color: var(--muted); padding: 8px 14px; border-radius: 999px;
  font-size: 12px; font-weight: 700; cursor: pointer; transition: .22s;
}
.tab span { font-family: var(--mono); font-size: 9px; margin-left: 5px; opacity: .55; }
.tab.active { background: var(--ink); color: #fff; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.item { padding: 20px; opacity: 0; animation: reveal .55s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: calc(var(--i) * 60ms); }
.item-top { display: flex; align-items: center; justify-content: space-between; }
.expiry-tag { color: var(--muted); }
.expiry-tag.permanent {
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--gold-soft);
  color: #81550f;
  letter-spacing: .08em;
}
.item h4 { margin: 14px 0 8px; font-size: 21px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.url {
  font-size: 10px; color: var(--muted); padding: 10px 12px; border-radius: 11px;
  background: rgba(16,24,34,.04); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.passcode-row, .saved-path { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; }
.passcode-row strong { letter-spacing: .18em; font-size: 12px; }
.saved-path strong { font-size: 10px; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 18px; }
.actions { display: flex; gap: 5px; }
.mini { padding: 6px 10px; font-size: 10px; }
.danger { color: #b42318; }
.empty { display: grid; justify-items: center; gap: 9px; padding: 56px 20px; text-align: center; }
.empty-mark { font-size: 42px; color: rgba(16,24,34,.16); }
.empty h4 { margin: 0; font-size: 25px; }
.empty p { margin: 0; font-size: 13px; color: var(--muted); }
@media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) {
  .bar-card { flex-direction: column; align-items: flex-start; }
  .item-foot { flex-direction: column; align-items: flex-start; }
}
</style>
