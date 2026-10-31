<script setup>
import { computed, ref } from 'vue'
import { api } from '../api.js'
import { store } from '../store.js'
import { notify } from '../toast.js'
import { fmtBytes, fmtDate, pct } from '../format.js'
import QrModal from '../components/QrModal.vue'

const emit = defineEmits(['changed'])

const qrOpen = ref(false)
const qrProvider = ref(null)
const editingId = ref('')
const editLabel = ref('')
const removeTarget = ref(null)

const providerMeta = {
  baidu: { label: '百度网盘', mark: '百', cls: 'teal', note: '扫码登录，把分享稳稳收进自己的云盘' },
  quark: { label: '夸克网盘', mark: '夸', cls: 'blue', note: '真实扫码链路，快速完成转存与再分享' },
  xunlei: { label: '迅雷网盘', mark: '迅', cls: 'gold', note: '设备码扫码，连接迅雷云盘空间' },
  demo: { label: '演示空间', mark: '演', cls: 'coral', note: '无需真实账号，完整体验搬运全流程' }
}

const accounts = computed(() => store.accounts)
const providerCounts = computed(() => accounts.value.reduce((counts, account) => {
  counts[account.provider] = (counts[account.provider] || 0) + 1
  return counts
}, {}))
const suggestedLabel = computed(() => {
  if (!qrProvider.value) return ''
  const count = providerCounts.value[qrProvider.value.id] || 0
  if (!count) return qrProvider.value.name
  return `${qrProvider.value.name} (${count + 1})`
})

function openQr(provider) {
  qrProvider.value = provider
  qrOpen.value = true
}

function onConnected() {
  emit('changed')
}

function providerOrdinal(account) {
  return accounts.value.filter((item) => item.provider === account.provider).findIndex((item) => item.id === account.id) + 1
}

function browse(account) {
  store.activeAccountId = account.id
  store.page = 'files'
}

function requestRemove(account) {
  removeTarget.value = account
}

async function confirmRemove() {
  const account = removeTarget.value
  if (!account) return
  try {
    await api.del(`/accounts/${account.id}`)
    removeTarget.value = null
    notify('账号已移除', 'success')
    emit('changed')
  } catch (err) {
    notify(err.message, 'error')
  }
}

function beginEdit(account) {
  editingId.value = account.id
  editLabel.value = account.label
}

async function saveEdit(account) {
  const label = editLabel.value.trim()
  if (!label) return notify('备注不能为空', 'error')
  try {
    await api.patch(`/accounts/${account.id}`, { label })
    editingId.value = ''
    notify('备注已更新', 'success')
    emit('changed')
  } catch (err) {
    notify(err.message, 'error')
  }
}
</script>

<template>
  <div class="accounts">
    <section class="providers">
      <div class="sec-head">
        <div>
          <div class="eyebrow">CONNECT A CLOUD</div>
          <h3 class="display">添加网盘</h3>
        </div>
        <span class="muted tiny">扫码或手动 Cookie</span>
      </div>
      <div class="provider-grid stagger">
        <button
          v-for="(p, i) in store.providers"
          :key="p.id"
          class="provider-card card"
          :class="providerMeta[p.id]?.cls"
          :data-mark="providerMeta[p.id]?.mark || '云'"
          :style="{ '--i': i }"
          @click="openQr(p)"
        >
          <span class="card-orbit" />
          <div class="p-top">
            <span class="p-mark">{{ providerMeta[p.id]?.mark || '云' }}</span>
            <span class="p-index mono">
              <b v-if="providerCounts[p.id]">{{ providerCounts[p.id] }} 个账号</b>
              <em>0{{ i + 1 }}</em>
            </span>
          </div>
          <div class="p-copy">
            <strong>{{ p.name }}</strong>
            <span>{{ providerMeta[p.id]?.note }}</span>
          </div>
          <div class="p-specs">
            <span v-if="p.qr">扫码</span>
            <i v-if="p.qr && (p.transfer || p.share)" />
            <span v-if="p.transfer">转存</span>
            <i v-if="p.transfer && p.share" />
            <span v-if="p.share">分享</span>
          </div>
          <div class="p-action">
            <span>{{ providerCounts[p.id] ? '再添加一个账号' : '添加账号' }}</span>
            <b>↗</b>
          </div>
        </button>
      </div>
    </section>

    <section class="list-sec">
      <div class="sec-head">
        <div>
          <div class="eyebrow">YOUR ACCOUNTS</div>
          <h3 class="display">已连接账号</h3>
        </div>
        <span class="muted tiny">{{ accounts.length }} 个账号 · 可多平台多账号</span>
      </div>

      <div v-if="!accounts.length" class="empty card">
        <div class="empty-orb">◎</div>
        <h4 class="display">还没有连接任何网盘</h4>
        <p>先连接一个账号。没有真实账号也没关系,「演示空间」可以完整体验转存与分享。</p>
        <button v-if="store.providers.find(p => p.id === 'demo')" class="btn btn-primary" @click="openQr(store.providers.find(p => p.id === 'demo'))">
          体验演示空间
        </button>
      </div>

      <div v-else class="account-grid">
        <article v-for="(a, i) in accounts" :key="a.id" class="account card" :style="{ '--i': i }">
          <div class="acc-head">
            <div class="acc-mark" :class="providerMeta[a.provider]?.cls">{{ providerMeta[a.provider]?.mark || '云' }}</div>
            <div class="acc-title">
              <template v-if="editingId === a.id">
                <div class="edit-row">
                  <input v-model="editLabel" class="input edit-input" @keyup.enter="saveEdit(a)" />
                  <button class="btn btn-primary mini" @click="saveEdit(a)">保存</button>
                </div>
              </template>
              <template v-else>
                <strong>{{ a.label }} <small class="acc-seq mono">#{{ String(providerOrdinal(a)).padStart(2, '0') }}</small></strong>
                <span class="muted">{{ providerMeta[a.provider]?.label || a.provider }}</span>
              </template>
            </div>
            <span class="tag" :class="a.hasCookie ? 'teal' : 'coral'">
              <i class="dot" />{{ a.hasCookie ? '已连接' : '未配置' }}
            </span>
          </div>

          <div class="usage">
            <div class="usage-head">
              <span class="tiny muted">容量</span>
              <span class="mono usage-num">
                {{ a.usage ? `${fmtBytes(a.usage.used)} / ${fmtBytes(a.usage.total)}` : '暂不可用' }}
              </span>
            </div>
            <div class="bar" :class="a.usage ? 'done' : ''">
              <i :style="{ width: a.usage ? pct(a.usage.used, a.usage.total) + '%' : '0%' }" />
            </div>
          </div>

          <div class="acc-foot">
            <span class="tiny muted">连接于 {{ fmtDate(a.createdAt) }}</span>
            <div class="acc-actions">
              <button class="btn btn-ghost mini" @click="browse(a)">浏览空间</button>
              <button class="btn btn-quiet mini" @click="beginEdit(a)">改名</button>
              <button class="btn btn-quiet mini danger" @click="requestRemove(a)">移除</button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <QrModal v-model="qrOpen" :provider="qrProvider" :suggested-label="suggestedLabel" @success="onConnected" />

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="removeTarget" class="backdrop" @click.self="removeTarget = null">
          <div class="confirm-card">
            <div class="confirm-mark">{{ providerMeta[removeTarget.provider]?.mark || '云' }}</div>
            <div>
              <div class="tiny muted">REMOVE ACCOUNT</div>
              <h3 class="display">移除「{{ removeTarget.label }}」？</h3>
              <p>仅删除云梭中保存的登录凭据，不会删除网盘里的任何文件。该平台的其它账号不受影响。</p>
            </div>
            <div class="confirm-actions">
              <button class="btn btn-ghost" @click="removeTarget = null">取消</button>
              <button class="btn btn-danger" @click="confirmRemove">确认移除</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.accounts { display: grid; gap: 30px; }
.sec-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 14px; }
.sec-head h3 { margin: 6px 0 0; font-size: 27px; }
.provider-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.provider-card {
  --accent: var(--teal);
  --accent-rgb: 15,118,110;
  position: relative;
  min-height: 244px;
  padding: 20px;
  border: 1px solid rgba(16,24,34,.08);
  border-radius: 22px;
  background:
    linear-gradient(148deg, rgba(var(--accent-rgb),.1), rgba(255,253,248,.94) 46%, rgba(255,253,248,.98));
  color: var(--ink);
  text-align: left;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  cursor: pointer;
  isolation: isolate;
  transition: transform .32s cubic-bezier(.2,.8,.2,1), box-shadow .32s, border-color .32s;
}
.provider-card.blue { --accent: var(--blue); --accent-rgb: 67,86,201; }
.provider-card.gold { --accent: var(--gold); --accent-rgb: 190,126,23; }
.provider-card.coral { --accent: var(--coral); --accent-rgb: 239,84,56; }
.provider-card::before {
  content: attr(data-mark);
  position: absolute;
  z-index: -1;
  right: -4px;
  top: 26px;
  font-family: var(--display);
  font-size: 116px;
  line-height: 1;
  color: var(--accent);
  opacity: .055;
  transform: rotate(5deg);
  transition: transform .45s, opacity .45s;
}
.provider-card:hover {
  transform: translateY(-6px);
  border-color: rgba(var(--accent-rgb),.35);
  box-shadow: 0 28px 64px rgba(48,34,18,.14);
}
.provider-card:hover::before { transform: rotate(-2deg) scale(1.06); opacity: .08; }
.provider-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.card-orbit {
  position: absolute;
  z-index: -1;
  width: 150px;
  height: 150px;
  border: 1px solid rgba(var(--accent-rgb),.18);
  border-radius: 50%;
  right: -78px;
  bottom: -70px;
  box-shadow:
    0 0 0 20px rgba(var(--accent-rgb),.035),
    0 0 0 42px rgba(var(--accent-rgb),.02);
  transition: transform .45s;
}
.provider-card:hover .card-orbit { transform: scale(1.12) translate(-5px,-5px); }
.p-top { display: flex; align-items: flex-start; justify-content: space-between; }
.p-mark {
  width: 50px; height: 50px; border-radius: 17px; display: grid; place-items: center;
  font-family: var(--display); font-size: 22px; background: var(--accent); color: #fff;
  box-shadow: 0 12px 26px rgba(var(--accent-rgb),.28);
  transform: rotate(-3deg);
  transition: transform .35s, box-shadow .35s;
}
.provider-card:hover .p-mark { transform: rotate(3deg) scale(1.05); box-shadow: 0 16px 32px rgba(var(--accent-rgb),.36); }
.p-index { display: grid; justify-items: end; gap: 4px; padding-top: 2px; }
.p-index b {
  padding: 4px 7px;
  border-radius: 999px;
  background: rgba(var(--accent-rgb), .11);
  color: var(--accent);
  font-family: var(--sans);
  font-size: 8px;
  letter-spacing: .04em;
}
.p-index em { font-style: normal; font-size: 9px; letter-spacing: .18em; color: rgba(16,24,34,.32); }
.p-copy { display: grid; gap: 6px; margin-top: 22px; }
.p-copy strong { font-size: 17px; letter-spacing: .01em; }
.p-copy span { font-size: 10px; line-height: 1.65; color: var(--muted); padding-right: 14px; }
.p-specs { display: flex; align-items: center; gap: 8px; margin-top: 12px; color: var(--accent); font-size: 10px; font-weight: 700; }
.p-specs i { width: 3px; height: 3px; border-radius: 50%; background: rgba(16,24,34,.22); }
.p-action {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-top: auto; padding-top: 15px; border-top: 1px solid rgba(16,24,34,.085);
  font-size: 11px; font-weight: 700;
}
.p-action b {
  width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(var(--accent-rgb),.1); color: var(--accent);
  font-size: 13px; font-weight: 400; transition: background .25s, color .25s, transform .3s;
}
.provider-card:hover .p-action b { background: var(--accent); color: #fff; transform: rotate(8deg); }
.account-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.account { padding: 18px; opacity: 0; animation: reveal .55s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: calc(var(--i) * 70ms); }
.acc-head { display: flex; align-items: center; gap: 12px; }
.acc-mark {
  width: 42px; height: 42px; border-radius: 13px; display: grid; place-items: center; flex: 0 0 auto;
  font-family: var(--display); font-size: 19px; background: var(--coral-soft); color: var(--coral);
}
.acc-mark.teal { background: var(--teal-soft); color: var(--teal); }
.acc-mark.blue { background: var(--blue-soft); color: var(--blue); }
.acc-mark.gold { background: var(--gold-soft); color: var(--gold); }
.acc-title { flex: 1; min-width: 0; display: grid; gap: 3px; }
.acc-title strong { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acc-seq { color: var(--muted); font-size: 8px; font-weight: 400; letter-spacing: .04em; }
.acc-title span { font-size: 10px; }
.edit-row { display: flex; gap: 6px; align-items: center; }
.edit-input { padding: 6px 9px; font-size: 12px; }
.mini { padding: 5px 10px; font-size: 10px; }
.usage { margin: 18px 0 14px; }
.usage-head { display: flex; justify-content: space-between; margin-bottom: 8px; }
.usage-num { font-size: 9px; color: var(--muted); }
.acc-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.acc-actions { display: flex; gap: 2px; }
.danger { color: #b42318; }
.danger:hover { background: var(--coral-soft); }
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 230;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(16, 24, 34, .5);
  backdrop-filter: blur(12px);
}
.confirm-card {
  width: min(470px, 100%);
  display: grid;
  gap: 16px;
  padding: 24px;
  border: 1px solid rgba(255,255,255,.35);
  border-radius: 25px;
  background: linear-gradient(180deg, #fffdf8, #f6f0e5);
  box-shadow: 0 40px 100px rgba(16, 24, 34, .36);
}
.confirm-mark {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  background: var(--coral-soft);
  color: var(--coral);
  font-family: var(--display);
  font-size: 20px;
}
.confirm-card h3 { margin: 5px 0 8px; font-size: 25px; }
.confirm-card p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.75; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 9px; }
.btn-danger { color: #fff; background: linear-gradient(135deg, #b42318, var(--coral)); }
.modal-enter-active, .modal-leave-active { transition: opacity .25s ease; }
.modal-enter-active .confirm-card, .modal-leave-active .confirm-card { transition: transform .34s cubic-bezier(.2,.9,.2,1), opacity .25s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .confirm-card, .modal-leave-to .confirm-card { opacity: 0; transform: translateY(18px) scale(.95); }
.empty { display: grid; justify-items: center; gap: 10px; padding: 46px 20px; text-align: center; }
.empty-orb { font-size: 40px; color: rgba(16,24,34,.16); }
.empty h4 { margin: 0; font-size: 24px; }
.empty p { max-width: 420px; margin: 0 0 8px; font-size: 13px; line-height: 1.8; color: var(--muted); }
@media (max-width: 1100px) { .provider-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) {
  .account-grid { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .provider-grid { grid-template-columns: 1fr; }
  .provider-card { min-height: 218px; }
  .acc-foot { flex-direction: column; align-items: flex-start; }
  .acc-actions { flex-wrap: wrap; }
}
</style>
