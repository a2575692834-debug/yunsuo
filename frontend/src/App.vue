<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { api } from './api.js'
import { store, clearSession, setSession, setTheme, themes } from './store.js'
import ToastHost from './components/ToastHost.vue'
import AuthView from './views/AuthView.vue'
import DashboardView from './views/DashboardView.vue'
import TransferView from './views/TransferView.vue'
import AccountsView from './views/AccountsView.vue'
import TasksView from './views/TasksView.vue'
import SharesView from './views/SharesView.vue'
import FilesView from './views/FilesView.vue'
import AdminView from './views/AdminView.vue'
import PublicView from './views/PublicView.vue'

const nav = [
  { key: 'dashboard', label: '概览', sub: 'OVERVIEW', icon: '◒' },
  { key: 'public', label: '公开资源', sub: 'DISCOVER', icon: '⌁' },
  { key: 'transfer', label: '智能转存', sub: 'TRANSFER', icon: '⇄' },
  { key: 'accounts', label: '网盘账号', sub: 'ACCOUNTS', icon: '◎' },
  { key: 'tasks', label: '任务中心', sub: 'TASKS', icon: '≋' },
  { key: 'shares', label: '分享库', sub: 'SHARES', icon: '↗' },
  { key: 'files', label: '我的空间', sub: 'FILES', icon: '▤' }
]

const adminNav = { key: 'admin', label: '管理后台', sub: 'ADMIN', icon: '◆', admin: true }
const visibleNav = computed(() => store.user?.isAdmin ? [...nav, adminNav] : nav)

const views = {
  dashboard: DashboardView,
  transfer: TransferView,
  accounts: AccountsView,
  tasks: TasksView,
  shares: SharesView,
  files: FilesView,
  public: PublicView,
  admin: AdminView
}

const currentView = computed(() => {
  if (store.page === 'admin' && !store.user?.isAdmin) return DashboardView
  return views[store.page] || DashboardView
})
const currentNav = computed(() => visibleNav.value.find((n) => n.key === store.page) || visibleNav.value[0])
const initial = computed(() => (store.user?.username || '云').slice(0, 1).toUpperCase())
const themeCurrent = computed(() => themes.find((theme) => theme.id === store.theme) || themes[0])
const themeOpen = ref(false)
const loading = ref(false)
const providerName = (id) => store.providers.find((provider) => provider.id === id)?.name || id

const pageMeta = {
  dashboard: { title: '把云,收拢到一处。', sub: '你的转存、分享与账号,都在这里汇合。' },
  public: { title: '去公开资源里,发现下一份收藏。', sub: '搜索大家已经生成的公开分享链接。' },
  transfer: { title: '让链接,抵达你的网盘。', sub: '粘贴分享文案,自动识别百度 / 夸克 / 迅雷。' },
  accounts: { title: '连接你的每一朵云。', sub: '扫码登录,或手动粘贴 Cookie。' },
  tasks: { title: '每一次搬运,都有迹可循。', sub: '实时进度、日志与取消。' },
  shares: { title: '分享,是云的第二次生命。', sub: '管理转存后生成的分享链接。' },
  files: { title: '你的空间,一目了然。', sub: '浏览账号里的文件与目录。' },
  admin: { title: '全站动向,尽在掌握。', sub: '管理员专属 · 用户、转存与分享全局视图。' }
}

async function loadBootstrap() {
  if (!store.token) return
  loading.value = true
  try {
    const [me, providers, accounts, overview] = await Promise.all([
      api.get('/auth/me'),
      api.get('/providers'),
      api.get('/accounts'),
      api.get('/overview')
    ])
    setSession(store.token, me.user)
    store.providers = providers
    store.accounts = accounts
    store.overview = overview
    if (!accounts.some((account) => account.id === store.activeAccountId)) {
      store.activeAccountId = accounts[0]?.id || ''
    }
  } catch (err) {
    // 401 会由 api 层处理;其它错误保持界面可用。
    console.warn(err.message)
  } finally {
    loading.value = false
    store.booted = true
  }
}

function logout() {
  clearSession()
  store.page = 'dashboard'
}

function onAuth() {
  loadBootstrap()
}

function chooseTheme(id) {
  setTheme(id)
  themeOpen.value = false
}

watch(() => store.page, (page) => {
  if (page === 'dashboard' || page === 'tasks' || page === 'shares') loadBootstrap()
})

onMounted(() => {
  if (store.token) loadBootstrap()
})
</script>

<template>
  <AuthView v-if="!store.token" @success="onAuth" />

  <div v-else class="shell">
    <aside class="side">
      <div class="side-brand">
        <span class="seal">梭</span>
        <div>
          <strong class="display">云梭</strong>
          <span class="mono">YUNSUO</span>
        </div>
      </div>

      <nav class="nav" :class="{ 'has-admin': store.user?.isAdmin }">
        <button
          v-for="(item, i) in visibleNav"
          :key="item.key"
          class="nav-item"
          :class="{ active: store.page === item.key, 'admin-nav': item.admin }"
          :style="{ '--i': i }"
          @click="store.page = item.key"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-copy">
            <strong>{{ item.label }}</strong>
            <small class="mono">{{ item.sub }}</small>
          </span>
          <span class="nav-arrow">→</span>
        </button>
      </nav>

      <div class="side-user">
        <div class="avatar">{{ initial }}</div>
        <div class="user-copy">
          <strong>{{ store.user?.username }}</strong>
          <small class="mono">MEMBER</small>
        </div>
        <button class="logout" title="退出登录" @click="logout">退出</button>
      </div>
    </aside>

    <div class="stage">
      <header class="topbar">
        <div class="crumb">
          <span class="mono tiny">{{ currentNav.sub }}</span>
          <span class="slash">/</span>
          <span>{{ currentNav.label }}</span>
        </div>
        <div class="top-actions">
          <div class="theme-switcher">
            <button
              class="theme-trigger"
              :aria-expanded="themeOpen"
              title="切换界面主题"
              @click="themeOpen = !themeOpen"
            >
              <span class="theme-stack">
                <i v-for="color in themeCurrent.colors" :key="color" :style="{ background: color }" />
              </span>
              <span>{{ themeCurrent.name }}</span>
              <b :class="{ open: themeOpen }">⌄</b>
            </button>
            <div v-if="themeOpen" class="theme-scrim" @click="themeOpen = false" />
            <Transition name="theme-menu">
              <div v-if="themeOpen" class="theme-menu">
                <div class="theme-menu-head">
                  <span class="mono">VISUAL THEME</span>
                  <strong class="display">换一种云的颜色</strong>
                </div>
                <button
                  v-for="theme in themes"
                  :key="theme.id"
                  class="theme-option"
                  :class="{ active: theme.id === store.theme }"
                  @click="chooseTheme(theme.id)"
                >
                  <span class="theme-preview" :class="`preview-${theme.id}`">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span class="theme-option-copy">
                    <strong>{{ theme.name }}</strong>
                    <small>{{ theme.description }}</small>
                  </span>
                  <span class="theme-check">{{ theme.id === store.theme ? '✓' : '' }}</span>
                </button>
              </div>
            </Transition>
          </div>
          <select v-if="store.accounts.length" v-model="store.activeAccountId" class="select account-select">
            <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.label }} · {{ providerName(a.provider) }}</option>
          </select>
          <button class="btn btn-ghost" @click="loadBootstrap">刷新</button>
        </div>
      </header>

      <main class="main">
        <div class="page-head">
          <div>
            <h1 class="display">{{ pageMeta[store.page]?.title }}</h1>
            <p class="muted">{{ pageMeta[store.page]?.sub }}</p>
          </div>
          <div class="head-mark mono">{{ String(visibleNav.findIndex(n => n.key === store.page) + 1).padStart(2, '0') }} / {{ String(visibleNav.length).padStart(2, '0') }}</div>
        </div>

        <Transition name="page" mode="out-in">
          <component
            :is="currentView"
            :key="store.page"
            @changed="loadBootstrap"
          />
        </Transition>
      </main>
    </div>

  </div>
  <ToastHost />
</template>

<style scoped>
.shell { min-height: 100vh; display: grid; grid-template-columns: 272px minmax(0, 1fr); }
.side {
  position: sticky; top: 0; height: 100vh;
  display: flex; flex-direction: column;
  padding: 26px 18px 18px;
  color: #f6f0e5;
  background:
    radial-gradient(400px 260px at 10% 0%, var(--side-glow), transparent 60%),
    linear-gradient(180deg, var(--side-a), var(--side-b) 68%);
  border-right: 1px solid rgba(255,255,255,.06);
  overflow: hidden;
}
.side::after {
  content: ""; position: absolute; width: 260px; height: 260px; border-radius: 50%;
  border: 1px solid rgba(246,240,229,.07); right: -150px; bottom: 12%;
  box-shadow: 0 0 0 38px rgba(246,240,229,.025), 0 0 0 76px rgba(246,240,229,.02);
  pointer-events: none;
}
.side-brand { display: flex; align-items: center; gap: 12px; padding: 2px 10px 26px; }
.seal {
  width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center;
  background: linear-gradient(135deg, var(--coral), #c93a22);
  font-family: var(--display); font-size: 21px; color: #fff;
  box-shadow: 0 12px 26px rgba(239,84,56,.3);
}
.side-brand strong { display: block; font-size: 20px; letter-spacing: .1em; }
.side-brand span.mono { font-size: 8px; letter-spacing: .3em; color: rgba(246,240,229,.4); }
.nav { display: grid; gap: 6px; }
.nav-item {
  position: relative; z-index: 2;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 12px; border: 0; border-radius: 14px;
  background: transparent; color: rgba(246,240,229,.62); text-align: left; cursor: pointer;
  transition: background .24s, color .24s, transform .24s;
  opacity: 0; transform: translateX(-10px);
  animation: reveal .5s cubic-bezier(.2,.8,.2,1) forwards;
  animation-delay: calc(var(--i) * 45ms + 80ms);
}
.nav-item:hover { background: rgba(246,240,229,.05); color: #fff; transform: translateX(2px); }
.nav-item.active {
  background: linear-gradient(100deg, rgba(239,84,56,.18), rgba(239,84,56,.04));
  color: #fff;
}
.nav-item.active::before {
  content: ""; position: absolute; left: -18px; top: 12px; bottom: 12px; width: 3px;
  border-radius: 999px; background: var(--coral); box-shadow: 0 0 18px rgba(239,84,56,.8);
}
.nav-icon {
  width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center;
  background: rgba(246,240,229,.06); font-size: 16px;
  transition: background .24s, color .24s, transform .24s;
}
.nav-item.active .nav-icon { background: rgba(239,84,56,.2); color: #ffb4a3; transform: rotate(-6deg); }
.nav-item.admin-nav .nav-icon { color: #e9bd69; }
.nav-item.admin-nav.active {
  background: linear-gradient(100deg, rgba(217,154,50,.2), rgba(217,154,50,.03));
}
.nav-item.admin-nav.active::before { background: var(--gold); box-shadow: 0 0 18px rgba(217,154,50,.75); }
.nav-item.admin-nav.active .nav-icon { background: rgba(217,154,50,.18); color: #f3d89f; }
.nav-copy { display: grid; gap: 2px; flex: 1; }
.nav-copy strong { font-size: 14px; letter-spacing: .02em; }
.nav-copy small { font-size: 8px; letter-spacing: .2em; opacity: .42; }
.nav-arrow { opacity: 0; transform: translateX(-6px); transition: .24s; font-size: 13px; }
.nav-item.active .nav-arrow { opacity: .8; transform: translateX(0); }
.side-user {
  margin-top: auto; position: relative; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  padding: 12px; border-radius: 16px;
  background: rgba(246,240,229,.05); border: 1px solid rgba(246,240,229,.08);
}
.avatar {
  width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center;
  background: linear-gradient(135deg, var(--gold), #b87a1f); color: #1b1405; font-weight: 800;
}
.user-copy { flex: 1; display: grid; gap: 2px; }
.user-copy strong { font-size: 13px; }
.user-copy small { font-size: 8px; letter-spacing: .2em; color: rgba(246,240,229,.38); }
.logout {
  border: 0; background: transparent; color: rgba(246,240,229,.5); cursor: pointer;
  font-size: 10px; font-weight: 700; padding: 6px 7px; border-radius: 9px; transition: .2s;
}
.logout:hover { background: rgba(239,84,56,.18); color: #ffb4a3; }
.stage { min-width: 0; display: flex; flex-direction: column; }
.topbar {
  position: sticky; top: 0; z-index: 30;
  height: 70px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 34px;
  background: var(--topbar); backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--line-soft);
}
.crumb { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--muted); }
.crumb .tiny { color: var(--ink-2); }
.slash { opacity: .3; }
.top-actions { display: flex; align-items: center; gap: 12px; }
.theme-switcher { position: relative; }
.theme-trigger {
  display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 11px 0 8px;
  border: 1px solid var(--line); border-radius: 999px; background: var(--ghost-bg);
  color: var(--ink-2); font-size: 10px; font-weight: 700; cursor: pointer;
  transition: transform .2s, background .2s, border-color .2s;
}
.theme-trigger:hover { transform: translateY(-1px); background: var(--field-strong); border-color: rgba(16,24,34,.24); }
.theme-stack { display: flex; width: 24px; height: 24px; position: relative; }
.theme-stack i {
  position: absolute; width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid var(--paper-2); box-shadow: 0 2px 5px rgba(0,0,0,.12);
}
.theme-stack i:nth-child(1) { left: 0; top: 4px; z-index: 3; }
.theme-stack i:nth-child(2) { left: 5px; top: 1px; z-index: 2; }
.theme-stack i:nth-child(3) { left: 9px; top: 7px; z-index: 1; }
.theme-trigger b { font-size: 13px; font-weight: 400; color: var(--muted); transition: transform .22s; }
.theme-trigger b.open { transform: rotate(180deg); }
.theme-scrim { position: fixed; inset: 0; z-index: 35; background: transparent; }
.theme-menu {
  position: absolute; z-index: 40; top: 48px; right: 0; width: 268px; padding: 9px;
  border: 1px solid var(--line); border-radius: 20px; background: var(--card-a);
  box-shadow: 0 24px 70px rgba(20, 27, 34, .2); transform-origin: top right;
}
.theme-menu-head { padding: 10px 11px 12px; display: grid; gap: 5px; border-bottom: 1px solid var(--line-soft); }
.theme-menu-head span { color: var(--muted); font-size: 7px; letter-spacing: .18em; }
.theme-menu-head strong { font-size: 17px; }
.theme-option {
  width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px;
  border: 1px solid transparent; border-radius: 14px; background: transparent;
  text-align: left; cursor: pointer; transition: background .18s, border-color .18s;
}
.theme-option:hover { background: var(--ink-soft); }
.theme-option.active { background: var(--coral-soft); border-color: rgba(239,84,56,.15); }
.theme-preview {
  position: relative; width: 49px; height: 34px; flex: 0 0 auto; overflow: hidden;
  border-radius: 9px; border: 1px solid rgba(16,24,34,.1); background: #f3ede2;
}
.theme-preview i { position: absolute; border-radius: 50%; }
.theme-preview i:nth-child(1) { width: 26px; height: 26px; left: -5px; top: 12px; }
.theme-preview i:nth-child(2) { width: 18px; height: 18px; right: 4px; top: 3px; }
.theme-preview i:nth-child(3) { width: 9px; height: 9px; left: 17px; top: 7px; }
.preview-cloud { background: #f3ede2; }
.preview-cloud i:nth-child(1) { background: #0f766e; }
.preview-cloud i:nth-child(2) { background: #ef5438; }
.preview-cloud i:nth-child(3) { background: #d99a32; }
.preview-sea { background: #e9f1f2; }
.preview-sea i:nth-child(1) { background: #287f70; }
.preview-sea i:nth-child(2) { background: #147d92; }
.preview-sea i:nth-child(3) { background: #d8a543; }
.preview-terra { background: #f1e5db; }
.preview-terra i:nth-child(1) { background: #657a50; }
.preview-terra i:nth-child(2) { background: #bd4d2d; }
.preview-terra i:nth-child(3) { background: #c18a36; }
.preview-moss { background: #e9ede3; }
.preview-moss i:nth-child(1) { background: #446b4a; }
.preview-moss i:nth-child(2) { background: #a95535; }
.preview-moss i:nth-child(3) { background: #b88b3d; }
.theme-option-copy { flex: 1; min-width: 0; display: grid; gap: 2px; }
.theme-option-copy strong { font-size: 11px; }
.theme-option-copy small { color: var(--muted); font-size: 8px; }
.theme-check { width: 18px; color: var(--coral); font-size: 11px; font-weight: 800; text-align: center; }
.theme-menu-enter-active, .theme-menu-leave-active { transition: opacity .18s ease, transform .24s cubic-bezier(.2,.8,.2,1); }
.theme-menu-enter-from, .theme-menu-leave-to { opacity: 0; transform: translateY(-7px) scale(.96); }
.account-select { width: 220px; padding: 8px 12px; font-size: 12px; border-radius: 999px; }
.main { position: relative; padding: 30px 34px 48px; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 26px; }
.page-head h1 { font-size: clamp(28px, 3vw, 42px); line-height: 1.16; margin: 0 0 8px; }
.page-head p { margin: 0; font-size: 13px; }
.head-mark { font-size: 10px; letter-spacing: .22em; color: rgba(16,24,34,.28); padding-bottom: 8px; }
@media (max-width: 980px) {
  .shell { grid-template-columns: 88px minmax(0, 1fr); }
  .side { padding: 22px 12px 14px; }
  .side-brand { justify-content: center; padding: 0 0 22px; }
  .side-brand > div { display: none; }
  .nav-item { justify-content: center; padding: 12px 0; }
  .nav-copy, .nav-arrow { display: none; }
  .nav-item.active::before { left: -12px; }
  .side-user { justify-content: center; padding: 10px 0; }
  .user-copy, .logout { display: none; }
  .main { padding: 24px 20px 40px; }
  .topbar { padding: 0 20px; }
}
@media (max-width: 680px) {
  .shell { display: block; padding-bottom: 78px; }
  .side {
    position: fixed; inset: auto 0 0 0; height: 70px; width: 100%;
    flex-direction: row; align-items: center; padding: 8px 10px; z-index: 80;
    border-right: 0; border-top: 1px solid rgba(255,255,255,.08);
  }
  .side::after, .side-brand, .side-user { display: none; }
  .nav { display: flex; grid-template-columns: none; width: 100%; gap: 2px; overflow-x: auto; scrollbar-width: none; }
  .nav::-webkit-scrollbar { display: none; }
  .nav-item { flex: 1 0 54px; min-width: 54px; flex-direction: column; gap: 3px; padding: 7px 0; border-radius: 12px; }
  .nav-item.active::before { left: 22%; right: 22%; top: -8px; bottom: auto; width: auto; height: 2px; }
  .nav-icon { width: 26px; height: 26px; font-size: 13px; background: transparent; }
  .nav-copy { display: block; }
  .nav-copy small, .nav-arrow { display: none; }
  .nav-copy strong { font-size: 10px; }
  .topbar { height: 60px; padding: 0 14px; }
  .top-actions .btn { display: none; }
  .theme-trigger { width: 38px; padding: 0; justify-content: center; }
  .theme-trigger > span:nth-child(2), .theme-trigger b { display: none; }
  .theme-menu { right: -56px; width: 250px; }
  .account-select { width: 175px; font-size: 10px; }
  .main { padding: 18px 14px 30px; }
  .page-head h1 { font-size: 27px; }
  .head-mark { display: none; }
}
</style>
