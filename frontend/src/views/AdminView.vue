<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { api } from '../api.js'
import { notify } from '../toast.js'
import { fmtDate, fmtTime } from '../format.js'
import { store } from '../store.js'

const loading = ref(false)
const overview = ref({
  stats: { users: 0, accounts: 0, transfers: 0, shares: 0, completed: 0, recent: 0 },
  providers: []
})
const activeTab = ref('users')

const users = reactive({
  items: [], total: 0, pages: 1, page: 1, q: '', loading: false, loaded: false
})
const accounts = reactive({
  items: [], total: 0, pages: 1, page: 1, q: '', provider: '', loading: false, loaded: false
})
const links = reactive({
  items: [], total: 0, pages: 1, page: 1, q: '', provider: '', loading: false, loaded: false
})

const confirmDialog = reactive({
  open: false, title: '', message: '', confirmLabel: '确认', danger: false,
  pending: false, action: null
})
const passwordDialog = reactive({
  open: false, user: null, password: '', confirm: '', pending: false
})
const cookieDialog = reactive({
  open: false, account: null, label: '', cookie: '', originalCookie: '',
  revealed: false, fetching: false, saving: false
})

let userTimer = null
let accountTimer = null
let linkTimer = null

const providerMeta = {
  baidu: { label: '百度网盘', short: '百', cls: 'teal' },
  quark: { label: '夸克网盘', short: '夸', cls: 'blue' },
  xunlei: { label: '迅雷网盘', short: '迅', cls: 'gold' },
  demo: { label: '演示空间', short: '演', cls: 'coral' }
}

const tabs = computed(() => [
  { key: 'users', label: '用户管理', sub: 'USERS', count: users.total },
  { key: 'accounts', label: '网盘凭据', sub: 'COOKIES', count: accounts.total },
  { key: 'links', label: '转存链接', sub: 'LINKS', count: links.total }
])

const stats = computed(() => [
  { key: 'users', label: '注册用户', sub: 'MEMBERS', value: overview.value.stats.users, mark: '人' },
  { key: 'accounts', label: '网盘账号', sub: 'ACCOUNTS', value: overview.value.stats.accounts, mark: '◎' },
  { key: 'transfers', label: '转存链接', sub: 'TRANSFERS', value: overview.value.stats.transfers, mark: '⇣' },
  { key: 'shares', label: '全站分享', sub: 'SHARES', value: overview.value.stats.shares, mark: '↗' },
  { key: 'completed', label: '完成任务', sub: 'COMPLETED', value: overview.value.stats.completed, mark: '✓' },
  { key: 'recent', label: '24H 新增', sub: 'LAST 24H', value: overview.value.stats.recent, mark: '24' }
])

const providerStats = computed(() => {
  const totalCount = overview.value.providers.reduce((sum, item) => sum + item.total, 0)
  return overview.value.providers.map((item) => ({
    ...item,
    label: providerMeta[item.provider]?.label || item.provider,
    cls: providerMeta[item.provider]?.cls || 'blue',
    percent: totalCount ? Math.round(item.total / totalCount * 100) : 0
  }))
})

const adminInitial = computed(() => (store.user?.username || 'A').slice(0, 1).toUpperCase())

async function loadOverview() {
  overview.value = await api.get('/admin/overview')
}

async function loadUsers() {
  users.loading = true
  try {
    const params = new URLSearchParams({
      q: users.q.trim(),
      page: String(users.page),
      pageSize: '20'
    })
    const data = await api.get(`/admin/users?${params}`)
    users.items = data.items
    users.total = data.total
    users.pages = data.pages
    users.loaded = true
    if (users.page > data.pages) {
      users.page = data.pages
      return loadUsers()
    }
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    users.loading = false
  }
}

async function loadAccounts() {
  accounts.loading = true
  try {
    const params = new URLSearchParams({
      q: accounts.q.trim(),
      provider: accounts.provider,
      page: String(accounts.page),
      pageSize: '20'
    })
    const data = await api.get(`/admin/accounts?${params}`)
    accounts.items = data.items
    accounts.total = data.total
    accounts.pages = data.pages
    accounts.loaded = true
    if (accounts.page > data.pages) {
      accounts.page = data.pages
      return loadAccounts()
    }
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    accounts.loading = false
  }
}

async function loadLinks() {
  links.loading = true
  try {
    const params = new URLSearchParams({
      q: links.q.trim(),
      provider: links.provider,
      page: String(links.page),
      pageSize: '20'
    })
    const data = await api.get(`/admin/transfers?${params}`)
    links.items = data.items
    links.total = data.total
    links.pages = data.pages
    links.loaded = true
    if (links.page > data.pages) {
      links.page = data.pages
      return loadLinks()
    }
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    links.loading = false
  }
}

function queueSearch(type) {
  const state = type === 'users' ? users : type === 'accounts' ? accounts : links
  const timer = type === 'users' ? userTimer : type === 'accounts' ? accountTimer : linkTimer
  if (timer) clearTimeout(timer)
  state.page = 1
  const nextTimer = setTimeout(() => {
    if (type === 'users') loadUsers()
    if (type === 'accounts') loadAccounts()
    if (type === 'links') loadLinks()
  }, 260)
  if (type === 'users') userTimer = nextTimer
  if (type === 'accounts') accountTimer = nextTimer
  if (type === 'links') linkTimer = nextTimer
}

function changePage(state, loader, next) {
  if (next < 1 || next > state.pages || next === state.page || state.loading) return
  state.page = next
  loader()
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

function askConfirm(options) {
  Object.assign(confirmDialog, {
    open: true,
    title: options.title,
    message: options.message,
    confirmLabel: options.confirmLabel || '确认',
    danger: !!options.danger,
    action: options.action,
    pending: false
  })
}

function closeConfirm() {
  if (confirmDialog.pending) return
  confirmDialog.open = false
  confirmDialog.action = null
}

async function runConfirm() {
  if (!confirmDialog.action || confirmDialog.pending) return
  confirmDialog.pending = true
  try {
    await confirmDialog.action()
    confirmDialog.open = false
    confirmDialog.action = null
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    confirmDialog.pending = false
  }
}

function toggleAdmin(user) {
  if (String(user.id) === String(store.user?.id)) {
    return notify('不能修改当前登录管理员自己的权限', 'error')
  }
  const makeAdmin = !user.isAdmin
  askConfirm({
    title: makeAdmin ? '授予管理员权限？' : '撤销管理员权限？',
    message: makeAdmin
      ? `@${user.username} 将可以查看全站用户、网盘凭据与转存记录。`
      : `@${user.username} 将失去后台入口和所有管理权限。`,
    confirmLabel: makeAdmin ? '授予权限' : '撤销权限',
    danger: !makeAdmin,
    action: async () => {
      await api.patch(`/admin/users/${user.id}`, { isAdmin: makeAdmin })
      notify(makeAdmin ? '已授予管理员权限' : '已撤销管理员权限', 'success')
      await Promise.all([loadUsers(), loadOverview()])
    }
  })
}

function openPasswordDialog(user) {
  Object.assign(passwordDialog, {
    open: true, user, password: '', confirm: '', pending: false
  })
}

function closePasswordDialog(force = false) {
  if (passwordDialog.pending && !force) return
  passwordDialog.open = false
  passwordDialog.user = null
  passwordDialog.password = ''
  passwordDialog.confirm = ''
}

async function resetPassword() {
  if (!passwordDialog.user || passwordDialog.pending) return
  if (passwordDialog.password.length < 6) return notify('新密码至少需要 6 位', 'error')
  if (passwordDialog.password !== passwordDialog.confirm) return notify('两次输入的密码不一致', 'error')
  passwordDialog.pending = true
  try {
    await api.patch(`/admin/users/${passwordDialog.user.id}`, { password: passwordDialog.password })
    notify(`@${passwordDialog.user.username} 的密码已重置`, 'success')
    closePasswordDialog(true)
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    passwordDialog.pending = false
  }
}

function removeUser(user) {
  if (String(user.id) === String(store.user?.id)) {
    return notify('不能删除当前登录管理员账号', 'error')
  }
  askConfirm({
    title: '删除这个用户？',
    message: `@${user.username} 的网盘账号、Cookie、任务、转存记录和分享记录都会被永久删除，此操作无法撤销。`,
    confirmLabel: '永久删除',
    danger: true,
    action: async () => {
      await api.del(`/admin/users/${user.id}`)
      notify('用户及其数据已删除', 'success')
      await Promise.all([loadUsers(), loadOverview()])
    }
  })
}

function openCookieDialog(account) {
  Object.assign(cookieDialog, {
    open: true,
    account,
    label: account.label,
    cookie: '',
    originalCookie: '',
    revealed: false,
    fetching: false,
    saving: false
  })
}

function closeCookieDialog(force = false) {
  if (cookieDialog.saving && !force) return
  cookieDialog.open = false
  cookieDialog.account = null
  cookieDialog.cookie = ''
  cookieDialog.originalCookie = ''
  cookieDialog.revealed = false
}

async function revealCookie() {
  if (!cookieDialog.account || cookieDialog.fetching) return
  if (cookieDialog.revealed) {
    cookieDialog.cookie = ''
    cookieDialog.originalCookie = ''
    cookieDialog.revealed = false
    return
  }
  cookieDialog.fetching = true
  try {
    const data = await api.get(`/admin/accounts/${cookieDialog.account.id}/cookie`)
    cookieDialog.cookie = data.cookie
    cookieDialog.originalCookie = data.cookie
    cookieDialog.revealed = true
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    cookieDialog.fetching = false
  }
}

async function saveCookie() {
  if (!cookieDialog.account || cookieDialog.saving) return
  const label = cookieDialog.label.trim()
  if (!label) return notify('账号备注不能为空', 'error')
  const cookieChanged = cookieDialog.cookie.trim() && cookieDialog.cookie !== cookieDialog.originalCookie
  if (!cookieChanged && label === cookieDialog.account.label) {
    return notify('没有需要保存的修改', 'info')
  }
  cookieDialog.saving = true
  try {
    const body = { label }
    if (cookieChanged) body.cookie = cookieDialog.cookie.trim()
    await api.patch(`/admin/accounts/${cookieDialog.account.id}`, body)
    notify(cookieChanged ? 'Cookie 已加密更新' : '账号备注已更新', 'success')
    closeCookieDialog(true)
    await Promise.all([loadAccounts(), loadOverview()])
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    cookieDialog.saving = false
  }
}

function removeCookie(account) {
  askConfirm({
    title: '删除这个网盘账号？',
    message: `@${account.username} 的「${account.label}」及其加密 Cookie 会被永久删除。之后该用户需要重新登录添加。`,
    confirmLabel: '删除账号',
    danger: true,
    action: async () => {
      await api.del(`/admin/accounts/${account.id}`)
      notify('网盘账号及 Cookie 已删除', 'success')
      await Promise.all([loadAccounts(), loadOverview()])
    }
  })
}

function removeLink(link) {
  askConfirm({
    title: '删除这条转存记录？',
    message: '这里只会删除数据库中的管理记录，不会删除用户网盘里的文件，也不会撤销已经生成的分享链接。',
    confirmLabel: '删除记录',
    danger: true,
    action: async () => {
      await api.del(`/admin/transfers/${link.id}`)
      notify('转存记录已从数据库删除', 'success')
      await Promise.all([loadLinks(), loadOverview()])
    }
  })
}

function switchTab(key) {
  activeTab.value = key
  if (key === 'users' && !users.loaded) loadUsers()
  if (key === 'accounts' && !accounts.loaded) loadAccounts()
  if (key === 'links' && !links.loaded) loadLinks()
}

watch(() => users.q, () => queueSearch('users'))
watch(() => accounts.q, () => queueSearch('accounts'))
watch(() => accounts.provider, () => queueSearch('accounts'))
watch(() => links.q, () => queueSearch('links'))
watch(() => links.provider, () => queueSearch('links'))

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([loadOverview(), loadUsers(), loadAccounts(), loadLinks()])
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="admin">
    <section class="admin-hero">
      <span class="hero-grid" />
      <span class="hero-orbit orbit-a" />
      <span class="hero-orbit orbit-b" />
      <div class="hero-main">
        <div class="admin-kicker mono"><i /> ADMIN COMMAND CENTER</div>
        <h3 class="display">全站数据，<br /><em>握在手里。</em></h3>
        <p>集中管理用户、加密网盘凭据与全站转存链接。所有敏感 Cookie 默认隐藏，查看行为只在管理员主动操作时发生。</p>
        <div class="hero-tags">
          <span class="hero-tag"><b>AES-256</b> 加密存储</span>
          <span class="hero-tag"><b>ADMIN</b> 服务端鉴权</span>
          <span class="hero-tag"><b>LIVE</b> 实时数据</span>
        </div>
      </div>
      <div class="hero-side">
        <div class="admin-identity">
          <span class="identity-avatar">{{ adminInitial }}</span>
          <div>
            <small class="mono">SIGNED IN AS</small>
            <strong>{{ store.user?.username }}</strong>
            <span>超级管理员</span>
          </div>
          <i class="live-dot" />
        </div>
        <div class="vault-card">
          <div class="vault-head">
            <span class="mono">DATA VAULT</span>
            <b>SECURE</b>
          </div>
          <div class="vault-row"><span>用户资料</span><strong>{{ overview.stats.users }}</strong></div>
          <div class="vault-row"><span>加密凭据</span><strong>{{ overview.stats.accounts }}</strong></div>
          <div class="vault-row"><span>链接档案</span><strong>{{ overview.stats.transfers }}</strong></div>
        </div>
      </div>
      <div v-if="providerStats.length" class="provider-mix">
        <div v-for="item in providerStats" :key="item.provider" class="mix-item" :class="item.cls">
          <span>{{ item.label }}</span>
          <strong class="mono">{{ item.percent }}%</strong>
          <i :style="{ width: item.percent + '%' }" />
        </div>
      </div>
    </section>

    <section class="stats">
      <article v-for="(item, i) in stats" :key="item.key" class="stat card" :style="{ '--i': i }">
        <span class="stat-mark">{{ item.mark }}</span>
        <div>
          <span class="mono">{{ item.sub }}</span>
          <strong class="display">{{ item.value }}</strong>
          <small>{{ item.label }}</small>
        </div>
      </article>
    </section>

    <section class="console card">
      <div class="console-head">
        <div>
          <div class="eyebrow">MANAGEMENT CONSOLE</div>
          <h3 class="display">数据中心</h3>
          <p>在一个工作台内完成用户权限、网盘 Cookie 和转存链接管理。</p>
        </div>
        <div class="console-clock">
          <small class="mono">ADMIN SESSION</small>
          <span><i class="dot live" /> 已连接</span>
        </div>
      </div>

      <div class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab"
          :class="{ active: activeTab === tab.key }"
          @click="switchTab(tab.key)"
        >
          <span class="tab-index mono">0{{ tabs.findIndex((item) => item.key === tab.key) + 1 }}</span>
          <span class="tab-copy">
            <strong>{{ tab.label }}</strong>
            <small class="mono">{{ tab.sub }}</small>
          </span>
          <b class="mono">{{ tab.count }}</b>
        </button>
      </div>

      <Transition name="admin-tab" mode="out-in">
        <div v-if="activeTab === 'users'" key="users" class="tab-panel">
          <div class="panel-toolbar">
            <div class="panel-title">
              <span class="panel-mark teal">U</span>
              <div>
                <strong>用户与权限</strong>
                <small>共 {{ users.total }} 位注册用户</small>
              </div>
            </div>
            <label class="search">
              <span>⌕</span>
              <input v-model="users.q" placeholder="搜索用户名" />
              <button v-if="users.q" @click="users.q = ''">×</button>
            </label>
          </div>

          <div class="table-shell">
            <div class="table-head user-grid">
              <span>用户</span><span>数据概览</span><span>权限</span><span>注册时间</span><span>操作</span>
            </div>
            <div v-if="users.loading" class="loading"><i /> 正在读取用户数据…</div>
            <div v-else-if="!users.items.length" class="empty">
              <span>⌕</span><strong>没有找到用户</strong><p>尝试更换搜索关键词。</p>
            </div>
            <template v-else>
              <article v-for="(user, i) in users.items" :key="user.id" class="data-row user-grid" :style="{ '--i': i }">
                <div class="user-cell">
                  <span class="user-avatar" :class="{ admin: user.isAdmin }">{{ user.username.slice(0, 1).toUpperCase() }}</span>
                  <div>
                    <strong>{{ user.username }}</strong>
                    <small class="mono">UID · {{ user.id }}</small>
                  </div>
                </div>
                <div class="metric-strip">
                  <span><b>{{ user.accountCount }}</b> 账号</span>
                  <span><b>{{ user.transferCount }}</b> 转存</span>
                  <span><b>{{ user.shareCount }}</b> 分享</span>
                </div>
                <div>
                  <span class="role-pill" :class="user.isAdmin ? 'is-admin' : 'is-member'">
                    <i /> {{ user.isAdmin ? '管理员' : '普通用户' }}
                  </span>
                </div>
                <time>{{ fmtDate(user.createdAt) }}</time>
                <div class="row-actions">
                  <button class="action-btn" @click="openPasswordDialog(user)">重置密码</button>
                  <button
                    class="action-btn"
                    :disabled="String(user.id) === String(store.user?.id)"
                    @click="toggleAdmin(user)"
                  >{{ user.isAdmin ? '撤权' : '授权' }}</button>
                  <button
                    class="action-btn danger"
                    :disabled="String(user.id) === String(store.user?.id)"
                    @click="removeUser(user)"
                  >删除</button>
                </div>
              </article>
            </template>
          </div>

          <div class="pager">
            <span class="mono">PAGE {{ users.page }} / {{ users.pages }}</span>
            <div>
              <button class="btn btn-ghost mini" :disabled="users.page <= 1" @click="changePage(users, loadUsers, users.page - 1)">← 上一页</button>
              <button class="btn btn-ghost mini" :disabled="users.page >= users.pages" @click="changePage(users, loadUsers, users.page + 1)">下一页 →</button>
            </div>
          </div>
        </div>

        <div v-else-if="activeTab === 'accounts'" key="accounts" class="tab-panel">
          <div class="panel-toolbar">
            <div class="panel-title">
              <span class="panel-mark gold">K</span>
              <div>
                <strong>网盘凭据库</strong>
                <small>共 {{ accounts.total }} 个账号 · 明文默认隐藏</small>
              </div>
            </div>
            <div class="filter-group">
              <label class="search compact">
                <span>⌕</span>
                <input v-model="accounts.q" placeholder="搜索用户或备注" />
                <button v-if="accounts.q" @click="accounts.q = ''">×</button>
              </label>
              <select v-model="accounts.provider" class="select filter-select">
                <option value="">全部网盘</option>
                <option value="baidu">百度</option>
                <option value="quark">夸克</option>
                <option value="xunlei">迅雷</option>
              </select>
            </div>
          </div>

          <div class="security-note">
            <span class="note-lock">⌾</span>
            <div>
              <strong>安全存储策略</strong>
              <p>Cookie 使用 AES-256-GCM 加密后写入数据库。列表接口不返回明文，只有点击「查看 / 更换」才会读取。</p>
            </div>
          </div>

          <div class="table-shell">
            <div class="table-head account-grid">
              <span>网盘账号</span><span>所属用户</span><span>Cookie 状态</span><span>最近更新</span><span>操作</span>
            </div>
            <div v-if="accounts.loading" class="loading"><i /> 正在读取凭据库…</div>
            <div v-else-if="!accounts.items.length" class="empty">
              <span>◎</span><strong>没有找到网盘账号</strong><p>用户添加百度、夸克或迅雷账号后会显示在这里。</p>
            </div>
            <template v-else>
              <article v-for="(account, i) in accounts.items" :key="account.id" class="data-row account-grid" :style="{ '--i': i }">
                <div class="account-cell">
                  <span class="provider-mark" :class="providerMeta[account.provider]?.cls || 'blue'">
                    {{ providerMeta[account.provider]?.short || '云' }}
                  </span>
                  <div>
                    <strong>{{ account.label }}</strong>
                    <small>{{ providerMeta[account.provider]?.label || account.provider }}</small>
                  </div>
                </div>
                <div class="owner-cell">
                  <span>@{{ account.username }}</span>
                  <small class="mono">UID {{ account.userId }}</small>
                </div>
                <div>
                  <span v-if="account.hasCookie" class="cookie-state saved"><i /> 已加密保存</span>
                  <span v-else class="cookie-state missing"><i /> 未保存</span>
                </div>
                <time>{{ fmtTime(account.updatedAt) }}</time>
                <div class="row-actions">
                  <button class="action-btn primary" @click="openCookieDialog(account)">查看 / 更换</button>
                  <button class="action-btn danger" @click="removeCookie(account)">删除</button>
                </div>
              </article>
            </template>
          </div>

          <div class="pager">
            <span class="mono">PAGE {{ accounts.page }} / {{ accounts.pages }}</span>
            <div>
              <button class="btn btn-ghost mini" :disabled="accounts.page <= 1" @click="changePage(accounts, loadAccounts, accounts.page - 1)">← 上一页</button>
              <button class="btn btn-ghost mini" :disabled="accounts.page >= accounts.pages" @click="changePage(accounts, loadAccounts, accounts.page + 1)">下一页 →</button>
            </div>
          </div>
        </div>

        <div v-else key="links" class="tab-panel">
          <div class="panel-toolbar">
            <div class="panel-title">
              <span class="panel-mark blue">L</span>
              <div>
                <strong>全站转存链接</strong>
                <small>共 {{ links.total }} 条数据库记录</small>
              </div>
            </div>
            <div class="filter-group">
              <label class="search compact wide">
                <span>⌕</span>
                <input v-model="links.q" placeholder="用户、文件名、源链接、提取码或分享链接" />
                <button v-if="links.q" @click="links.q = ''">×</button>
              </label>
              <select v-model="links.provider" class="select filter-select">
                <option value="">全部网盘</option>
                <option value="baidu">百度</option>
                <option value="quark">夸克</option>
                <option value="xunlei">迅雷</option>
                <option value="demo">演示</option>
              </select>
            </div>
          </div>

          <div class="table-shell">
            <div class="table-head link-grid">
              <span>资源 / 用户</span><span>源链接</span><span>保存与分享</span><span>时间</span><span>操作</span>
            </div>
            <div v-if="links.loading" class="loading"><i /> 正在检索全站链接…</div>
            <div v-else-if="!links.items.length" class="empty">
              <span>⌕</span><strong>没有找到转存链接</strong><p>试试更换关键词或网盘筛选。</p>
            </div>
            <template v-else>
              <article v-for="(link, i) in links.items" :key="link.id" class="data-row link-grid" :style="{ '--i': i }">
                <div class="link-resource">
                  <span class="provider-mark small" :class="providerMeta[link.provider]?.cls || 'blue'">
                    {{ providerMeta[link.provider]?.short || '云' }}
                  </span>
                  <div>
                    <strong :title="link.title">{{ link.title || '未命名资源' }}</strong>
                    <small>@{{ link.username }} · {{ link.accountLabel || providerMeta[link.provider]?.label || link.provider }}</small>
                  </div>
                </div>
                <div class="source-stack">
                  <a :href="link.sourceUrl" target="_blank" rel="noreferrer">{{ link.sourceUrl }}</a>
                  <div>
                    <span v-if="link.sourceCode" class="code-chip mono">提取码 {{ link.sourceCode }}</span>
                    <button @click="copy(link.sourceUrl, '源链接')">复制链接</button>
                  </div>
                </div>
                <div class="save-stack">
                  <span class="path" :title="link.savedPath">{{ link.savedPath || '/' }}</span>
                  <a v-if="link.shareUrl" :href="link.shareUrl" target="_blank" rel="noreferrer">
                    分享 ↗ <b v-if="link.sharePasscode" class="mono">{{ link.sharePasscode }}</b>
                  </a>
                  <small v-else>未生成分享</small>
                </div>
                <time>{{ fmtTime(link.createdAt) }}</time>
                <div class="row-actions">
                  <button v-if="link.shareUrl" class="action-btn" @click="copy(link.shareUrl, '分享链接')">复制分享</button>
                  <button class="action-btn danger" @click="removeLink(link)">删除记录</button>
                </div>
              </article>
            </template>
          </div>

          <div class="pager">
            <span class="mono">PAGE {{ links.page }} / {{ links.pages }}</span>
            <div>
              <button class="btn btn-ghost mini" :disabled="links.page <= 1" @click="changePage(links, loadLinks, links.page - 1)">← 上一页</button>
              <button class="btn btn-ghost mini" :disabled="links.page >= links.pages" @click="changePage(links, loadLinks, links.page + 1)">下一页 →</button>
            </div>
          </div>
        </div>
      </Transition>
    </section>

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="confirmDialog.open" class="modal-layer" @click.self="closeConfirm">
          <section class="modal-card confirm-card">
            <span class="modal-mark" :class="{ danger: confirmDialog.danger }">!</span>
            <div class="modal-heading">
              <small class="mono">PLEASE CONFIRM</small>
              <h4 class="display">{{ confirmDialog.title }}</h4>
              <p>{{ confirmDialog.message }}</p>
            </div>
            <div class="modal-actions">
              <button class="btn btn-ghost" :disabled="confirmDialog.pending" @click="closeConfirm">取消</button>
              <button
                class="btn"
                :class="confirmDialog.danger ? 'btn-danger' : 'btn-primary'"
                :disabled="confirmDialog.pending"
                @click="runConfirm"
              >{{ confirmDialog.pending ? '处理中…' : confirmDialog.confirmLabel }}</button>
            </div>
          </section>
        </div>
      </Transition>

      <Transition name="modal">
        <div v-if="passwordDialog.open" class="modal-layer" @click.self="closePasswordDialog()">
          <section class="modal-card">
            <button class="modal-close" @click="closePasswordDialog()">×</button>
            <div class="modal-heading">
              <small class="mono">RESET PASSWORD</small>
              <h4 class="display">重置 @{{ passwordDialog.user?.username }} 的密码</h4>
              <p>新密码会立即生效，旧密码将无法继续登录。</p>
            </div>
            <div class="modal-fields">
              <label class="field">
                <span>新密码</span>
                <input v-model="passwordDialog.password" class="input" type="password" autocomplete="new-password" placeholder="至少 6 位" />
              </label>
              <label class="field">
                <span>确认新密码</span>
                <input v-model="passwordDialog.confirm" class="input" type="password" autocomplete="new-password" placeholder="再次输入" @keyup.enter="resetPassword" />
              </label>
            </div>
            <div class="modal-actions">
              <button class="btn btn-ghost" :disabled="passwordDialog.pending" @click="closePasswordDialog()">取消</button>
              <button class="btn btn-primary" :disabled="passwordDialog.pending" @click="resetPassword">
                {{ passwordDialog.pending ? '保存中…' : '确认重置' }}
              </button>
            </div>
          </section>
        </div>
      </Transition>

      <Transition name="modal">
        <div v-if="cookieDialog.open" class="modal-layer" @click.self="closeCookieDialog()">
          <section class="modal-card cookie-modal">
            <button class="modal-close" @click="closeCookieDialog()">×</button>
            <div class="cookie-modal-head">
              <span class="provider-mark" :class="providerMeta[cookieDialog.account?.provider]?.cls || 'blue'">
                {{ providerMeta[cookieDialog.account?.provider]?.short || '云' }}
              </span>
              <div>
                <small class="mono">ENCRYPTED CREDENTIAL</small>
                <h4 class="display">{{ cookieDialog.account?.label }}</h4>
                <p>@{{ cookieDialog.account?.username }} · {{ providerMeta[cookieDialog.account?.provider]?.label }}</p>
              </div>
            </div>
            <div class="modal-fields">
              <label class="field">
                <span>账号备注</span>
                <input v-model="cookieDialog.label" class="input" maxlength="80" />
              </label>
              <label class="field">
                <span>Cookie</span>
                <textarea
                  v-model="cookieDialog.cookie"
                  class="textarea cookie-area"
                  spellcheck="false"
                  :placeholder="cookieDialog.revealed ? '' : '已加密隐藏。点击下方「显示已保存 Cookie」，或直接粘贴新的 Cookie 覆盖。'"
                />
              </label>
            </div>
            <div class="cookie-security">
              <span>⌾</span>
              <p>该内容只会在当前弹窗中显示。请不要截图、分享或粘贴到不受信任的页面。</p>
            </div>
            <div class="modal-actions split">
              <div>
                <button class="btn btn-ghost" :disabled="cookieDialog.fetching" @click="revealCookie">
                  {{ cookieDialog.fetching ? '读取中…' : cookieDialog.revealed ? '隐藏 Cookie' : '显示已保存 Cookie' }}
                </button>
                <button v-if="cookieDialog.cookie" class="btn btn-quiet" @click="copy(cookieDialog.cookie, 'Cookie')">复制</button>
              </div>
              <div>
                <button class="btn btn-ghost" :disabled="cookieDialog.saving" @click="closeCookieDialog()">取消</button>
                <button class="btn btn-primary" :disabled="cookieDialog.saving" @click="saveCookie">
                  {{ cookieDialog.saving ? '加密保存中…' : '保存修改' }}
                </button>
              </div>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.admin { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 18px; }
.admin-hero {
  position: relative;
  min-height: 300px;
  padding: 34px 38px 70px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 310px;
  gap: 40px;
  border-radius: 28px;
  color: #f6f0e5;
  background:
    radial-gradient(500px 300px at 84% 5%, rgba(217,154,50,.2), transparent 66%),
    radial-gradient(460px 340px at 55% 120%, rgba(15,118,110,.18), transparent 68%),
    linear-gradient(135deg, #121c29, #0b121a 66%);
  box-shadow: 0 30px 80px rgba(16,24,34,.22);
  overflow: hidden;
}
.hero-grid {
  position: absolute; inset: 0; opacity: .25;
  background-image:
    linear-gradient(rgba(246,240,229,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(246,240,229,.05) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: linear-gradient(to bottom, #000, transparent 82%);
}
.hero-orbit { position: absolute; border-radius: 50%; border: 1px solid rgba(246,240,229,.09); pointer-events: none; }
.orbit-a { width: 360px; height: 360px; right: -116px; top: -150px; box-shadow: 0 0 0 38px rgba(246,240,229,.016); }
.orbit-b { width: 190px; height: 190px; right: 64px; top: -78px; border-style: dashed; border-color: rgba(217,154,50,.2); animation: spin-slow 36s linear infinite; }
.hero-main, .hero-side, .provider-mix { position: relative; z-index: 2; }
.admin-kicker {
  display: flex; align-items: center; gap: 9px;
  font-size: 9px; letter-spacing: .24em; color: rgba(246,240,229,.5);
}
.admin-kicker i { width: 7px; height: 7px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 0 5px rgba(217,154,50,.12); }
.hero-main h3 { margin: 19px 0 13px; font-size: clamp(36px, 4vw, 54px); line-height: 1.08; }
.hero-main h3 em { color: #e8bf72; font-style: normal; }
.hero-main > p { max-width: 570px; margin: 0; color: rgba(246,240,229,.54); font-size: 12px; line-height: 1.9; }
.hero-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.hero-tag {
  padding: 7px 11px; border: 1px solid rgba(246,240,229,.1); border-radius: 999px;
  background: rgba(246,240,229,.035); color: rgba(246,240,229,.5); font-size: 9px;
}
.hero-tag b { margin-right: 4px; color: #e7c88e; font-family: var(--mono); font-size: 8px; letter-spacing: .1em; }
.hero-side { display: grid; gap: 12px; align-content: start; }
.admin-identity {
  display: flex; align-items: center; gap: 11px; padding: 13px;
  border: 1px solid rgba(246,240,229,.1); border-radius: 18px;
  background: rgba(246,240,229,.055); backdrop-filter: blur(12px);
}
.identity-avatar {
  width: 42px; height: 42px; border-radius: 13px; display: grid; place-items: center;
  background: linear-gradient(135deg, var(--gold), #af721b); color: #171006;
  font-family: var(--display); font-size: 18px; font-weight: 800;
}
.admin-identity > div { flex: 1; display: grid; gap: 2px; }
.admin-identity small { color: rgba(246,240,229,.35); font-size: 7px; letter-spacing: .18em; }
.admin-identity strong { font-size: 13px; }
.admin-identity span:not(.identity-avatar) { color: rgba(246,240,229,.43); font-size: 9px; }
.live-dot { width: 7px; height: 7px; border-radius: 50%; background: #55cbb1; box-shadow: 0 0 0 5px rgba(85,203,177,.1); animation: pulse 1.8s infinite; }
.vault-card { padding: 15px; border: 1px solid rgba(246,240,229,.09); border-radius: 18px; background: rgba(5,10,16,.26); }
.vault-head { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px solid rgba(246,240,229,.08); }
.vault-head span { color: rgba(246,240,229,.34); font-size: 7px; letter-spacing: .18em; }
.vault-head b { color: #6bd3bd; font-family: var(--mono); font-size: 7px; letter-spacing: .12em; }
.vault-row { display: flex; justify-content: space-between; align-items: baseline; padding-top: 9px; }
.vault-row span { color: rgba(246,240,229,.45); font-size: 9px; }
.vault-row strong { font-family: var(--display); font-size: 19px; color: #f6f0e5; }
.provider-mix {
  position: absolute; left: 38px; right: 38px; bottom: 24px;
  display: flex; gap: 16px; flex-wrap: wrap;
}
.mix-item {
  position: relative; min-width: 136px; padding-bottom: 6px;
  display: flex; justify-content: space-between; gap: 16px;
  border-bottom: 2px solid rgba(246,240,229,.09);
}
.mix-item span, .mix-item strong { font-size: 9px; }
.mix-item span { color: rgba(246,240,229,.42); }
.mix-item strong { color: rgba(246,240,229,.75); }
.mix-item > i { position: absolute; left: 0; bottom: -2px; height: 2px; background: var(--teal); }
.mix-item.blue > i { background: #8ea1ff; }
.mix-item.gold > i { background: var(--gold); }
.mix-item.coral > i { background: var(--coral); }

.stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.stat {
  padding: 15px; display: flex; gap: 11px; align-items: flex-start;
  opacity: 0; animation: reveal .5s cubic-bezier(.2,.8,.2,1) forwards;
  animation-delay: calc(var(--i) * 48ms);
}
.stat-mark {
  width: 33px; height: 33px; flex: 0 0 auto; border-radius: 10px;
  display: grid; place-items: center; background: var(--gold-soft); color: #9a6815;
  font-family: var(--mono); font-size: 10px;
}
.stat:nth-child(2) .stat-mark { background: var(--teal-soft); color: var(--teal); }
.stat:nth-child(3) .stat-mark { background: var(--blue-soft); color: var(--blue); }
.stat:nth-child(4) .stat-mark { background: var(--coral-soft); color: var(--coral); }
.stat:nth-child(5) .stat-mark { background: rgba(16,24,34,.07); color: var(--ink); }
.stat:nth-child(6) .stat-mark { background: var(--gold-soft); color: #a76f14; }
.stat > div { display: grid; }
.stat span.mono { font-size: 7px; letter-spacing: .14em; color: var(--muted); }
.stat strong { margin: 3px 0 0; font-size: 25px; line-height: 1; }
.stat small { margin-top: 4px; font-size: 9px; color: var(--muted); }

.console { min-width: 0; padding: 25px; overflow: visible; }
.console::after { border-radius: inherit; }
.console-head { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }
.console-head h3 { margin: 7px 0 4px; font-size: 29px; }
.console-head p { margin: 0; color: var(--muted); font-size: 11px; }
.console-clock { display: grid; justify-items: end; gap: 4px; }
.console-clock small { color: var(--muted); font-size: 7px; letter-spacing: .16em; }
.console-clock span { display: flex; align-items: center; gap: 7px; font-size: 10px; font-weight: 700; color: var(--teal); }
.console-clock .dot { width: 6px; height: 6px; }
.tabs { position: relative; z-index: 1; display: flex; gap: 7px; margin: 21px 0 14px; padding: 6px; border-radius: 18px; background: var(--ink-soft); }
.tab {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px;
  padding: 10px 13px; border: 1px solid transparent; border-radius: 13px;
  background: transparent; text-align: left; cursor: pointer;
  transition: background .22s, border-color .22s, transform .22s, box-shadow .22s;
}
.tab:hover { background: rgba(255,255,255,.38); }
.tab.active { background: var(--field-strong); border-color: var(--line); box-shadow: 0 8px 24px rgba(20,27,34,.07); transform: translateY(-1px); }
.tab-index { color: var(--muted); font-size: 8px; }
.tab-copy { flex: 1; min-width: 0; display: grid; gap: 1px; }
.tab-copy strong { font-size: 12px; }
.tab-copy small { color: var(--muted); font-size: 7px; letter-spacing: .14em; }
.tab > b { min-width: 26px; padding: 4px 7px; border-radius: 999px; background: var(--ink-soft); color: var(--muted); font-size: 8px; text-align: center; }
.tab.active > b { background: var(--coral-soft); color: var(--coral); }
.tab-panel { position: relative; z-index: 1; min-width: 0; }
.panel-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 8px 1px 14px; }
.panel-title { display: flex; align-items: center; gap: 10px; }
.panel-mark { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 11px; background: var(--teal-soft); color: var(--teal); font-family: var(--display); font-weight: 800; }
.panel-mark.gold { background: var(--gold-soft); color: #9a6815; }
.panel-mark.blue { background: var(--blue-soft); color: var(--blue); }
.panel-title > div { display: grid; gap: 2px; }
.panel-title strong { font-size: 13px; }
.panel-title small { color: var(--muted); font-size: 9px; }
.filter-group { display: flex; gap: 8px; }
.search {
  width: min(290px, 30vw); height: 38px; display: flex; align-items: center; gap: 7px;
  padding: 0 12px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--field-bg); transition: border-color .2s, box-shadow .2s;
}
.search:focus-within { border-color: rgba(239,84,56,.5); box-shadow: 0 0 0 4px rgba(239,84,56,.08); }
.search.compact { width: 235px; }
.search.wide { width: 320px; }
.search > span { color: var(--muted); font-size: 17px; }
.search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 10px; }
.search button { border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 16px; }
.filter-select { width: 112px; height: 38px; padding: 0 10px; border-radius: 999px; font-size: 10px; }
.security-note {
  display: flex; align-items: center; gap: 11px; margin-bottom: 12px; padding: 11px 14px;
  border: 1px solid rgba(15,118,110,.13); border-radius: 14px;
  background: linear-gradient(100deg, rgba(15,118,110,.075), rgba(15,118,110,.018));
}
.note-lock { width: 31px; height: 31px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 10px; background: var(--teal-soft); color: var(--teal); }
.security-note > div { display: grid; gap: 2px; }
.security-note strong { font-size: 10px; color: var(--teal); }
.security-note p { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.55; }
.table-shell { border: 1px solid var(--line-soft); border-radius: 16px; overflow: hidden; }
.table-head, .data-row {
  display: grid; gap: 14px; align-items: center;
}
.user-grid { grid-template-columns: minmax(180px, 1.2fr) minmax(175px, 1fr) 96px 96px minmax(170px, 1fr); }
.account-grid { grid-template-columns: minmax(180px, 1.15fr) minmax(120px, .8fr) 125px 125px minmax(165px, 1fr); }
.link-grid { grid-template-columns: minmax(190px, 1.1fr) minmax(200px, 1.2fr) minmax(145px, .9fr) 100px minmax(160px, .9fr); }
.table-head {
  padding: 9px 14px; background: rgba(16,24,34,.035);
  color: var(--muted); font-size: 7px; letter-spacing: .15em; text-transform: uppercase;
}
.data-row {
  min-height: 70px; padding: 11px 14px; border-top: 1px solid var(--line-soft);
  opacity: 0; animation: reveal .42s cubic-bezier(.2,.8,.2,1) forwards;
  animation-delay: calc(var(--i) * 26ms);
  transition: background .18s;
}
.data-row:hover { background: rgba(255,253,248,.68); }
.user-cell, .account-cell, .link-resource { display: flex; align-items: center; gap: 10px; min-width: 0; }
.user-avatar {
  width: 34px; height: 34px; flex: 0 0 auto; display: grid; place-items: center;
  border-radius: 11px; background: var(--blue-soft); color: var(--blue);
  font-family: var(--display); font-size: 14px; font-weight: 800;
}
.user-avatar.admin { background: linear-gradient(135deg, var(--gold-soft), #f3dcae); color: #8f5c0f; }
.user-cell > div, .account-cell > div, .link-resource > div { min-width: 0; display: grid; gap: 3px; }
.user-cell strong, .account-cell strong, .link-resource strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.user-cell small, .account-cell small, .link-resource small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 8px; }
.user-cell small { letter-spacing: .08em; }
.metric-strip { display: flex; gap: 6px; flex-wrap: wrap; }
.metric-strip span { padding: 5px 7px; border-radius: 8px; background: var(--ink-soft); color: var(--muted); font-size: 8px; white-space: nowrap; }
.metric-strip b { margin-right: 2px; color: var(--ink); font-family: var(--mono); font-size: 9px; }
.role-pill, .cookie-state {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px;
  border-radius: 999px; font-size: 8px; font-weight: 700; white-space: nowrap;
}
.role-pill i, .cookie-state i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.role-pill.is-admin { background: var(--gold-soft); color: #97640f; }
.role-pill.is-member { background: var(--blue-soft); color: var(--blue); }
.cookie-state.saved { background: var(--teal-soft); color: var(--teal); }
.cookie-state.missing { background: var(--coral-soft); color: var(--coral); }
.provider-mark {
  width: 35px; height: 35px; flex: 0 0 auto; display: grid; place-items: center;
  border-radius: 11px; background: var(--teal-soft); color: var(--teal);
  font-family: var(--display); font-size: 14px; font-weight: 800;
}
.provider-mark.small { width: 31px; height: 31px; border-radius: 10px; font-size: 12px; }
.provider-mark.blue { background: var(--blue-soft); color: var(--blue); }
.provider-mark.gold { background: var(--gold-soft); color: #9a6815; }
.provider-mark.coral { background: var(--coral-soft); color: var(--coral); }
.owner-cell { display: grid; gap: 3px; }
.owner-cell span { font-size: 10px; }
.owner-cell small { color: var(--muted); font-size: 7px; letter-spacing: .08em; }
.data-row time { color: var(--muted); font-size: 8px; line-height: 1.5; }
.row-actions { display: flex; justify-content: flex-end; gap: 5px; flex-wrap: wrap; }
.action-btn {
  border: 1px solid var(--line-soft); border-radius: 8px; padding: 6px 8px;
  background: var(--ghost-bg); color: var(--muted); font-size: 8px; font-weight: 700;
  cursor: pointer; transition: color .18s, background .18s, border-color .18s, transform .18s;
}
.action-btn:hover { color: var(--ink); background: var(--field-strong); border-color: var(--line); transform: translateY(-1px); }
.action-btn.primary { color: var(--teal); background: var(--teal-soft); border-color: transparent; }
.action-btn.danger:hover { color: #b42318; background: var(--coral-soft); border-color: rgba(239,84,56,.14); }
.action-btn:disabled { opacity: .35; cursor: not-allowed; transform: none; }
.source-stack, .save-stack { min-width: 0; display: grid; gap: 5px; }
.source-stack a {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--blue); font-family: var(--mono); font-size: 8px; text-decoration: none;
}
.source-stack > div { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.source-stack button {
  border: 0; border-radius: 6px; padding: 3px 6px; background: rgba(16,24,34,.05);
  color: var(--muted); font-size: 7px; cursor: pointer;
}
.code-chip { padding: 3px 6px; border-radius: 6px; background: var(--gold-soft); color: #93620f; font-size: 7px; }
.save-stack .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-family: var(--mono); font-size: 8px; }
.save-stack a { width: fit-content; color: var(--teal); font-size: 9px; font-weight: 700; text-decoration: none; }
.save-stack a b { margin-left: 3px; font-size: 7px; color: var(--muted); }
.save-stack small { color: var(--muted); font-size: 8px; }
.loading, .empty { min-height: 170px; display: grid; place-items: center; align-content: center; gap: 8px; color: var(--muted); font-size: 11px; text-align: center; }
.loading { display: flex; align-items: center; justify-content: center; gap: 9px; }
.loading i { width: 13px; height: 13px; border: 2px solid var(--line); border-top-color: var(--coral); border-radius: 50%; animation: spin-slow .8s linear infinite; }
.empty > span { font-size: 31px; opacity: .28; }
.empty strong { color: var(--ink); font-size: 13px; }
.empty p { margin: 0; font-size: 10px; }
.pager { display: flex; justify-content: space-between; align-items: center; margin-top: 13px; }
.pager > span { color: var(--muted); font-size: 8px; letter-spacing: .15em; }
.pager > div { display: flex; gap: 6px; }
.mini { padding: 6px 11px; font-size: 9px; }
.btn-danger { color: #fff; background: linear-gradient(135deg, #d13c2f, #aa271d); box-shadow: 0 12px 28px rgba(180,35,24,.22); }
.admin-tab-enter-active, .admin-tab-leave-active { transition: opacity .2s ease, transform .25s cubic-bezier(.2,.8,.2,1), filter .2s; }
.admin-tab-enter-from { opacity: 0; transform: translateY(9px); filter: blur(2px); }
.admin-tab-leave-to { opacity: 0; transform: translateY(-5px); }

.modal-layer {
  position: fixed; inset: 0; z-index: 200; display: grid; place-items: center;
  padding: 20px; background: rgba(8,13,19,.55); backdrop-filter: blur(10px);
}
.modal-card {
  position: relative; width: min(480px, 100%); padding: 25px;
  border: 1px solid var(--line); border-radius: 24px;
  background: linear-gradient(180deg, var(--field-strong), var(--paper-2));
  box-shadow: 0 34px 100px rgba(4,9,14,.3);
}
.cookie-modal { width: min(680px, 100%); }
.modal-card::before {
  content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: linear-gradient(120deg, rgba(255,255,255,.5), transparent 35%);
}
.modal-close {
  position: absolute; z-index: 2; right: 15px; top: 15px;
  width: 30px; height: 30px; border: 0; border-radius: 50%;
  background: var(--ink-soft); color: var(--muted); font-size: 18px; cursor: pointer;
}
.modal-mark {
  width: 46px; height: 46px; display: grid; place-items: center; margin-bottom: 14px;
  border-radius: 15px; background: var(--gold-soft); color: #97640f;
  font-family: var(--display); font-size: 22px; font-weight: 800;
}
.modal-mark.danger { background: var(--coral-soft); color: var(--coral); }
.modal-heading { position: relative; z-index: 1; display: grid; gap: 7px; }
.modal-heading small, .cookie-modal-head small { color: var(--muted); font-size: 7px; letter-spacing: .17em; }
.modal-heading h4, .cookie-modal-head h4 { margin: 0; font-size: 25px; line-height: 1.2; }
.modal-heading p, .cookie-modal-head p { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.7; }
.modal-fields { position: relative; z-index: 1; display: grid; gap: 13px; margin-top: 19px; }
.field > span { display: block; margin-bottom: 7px; color: var(--ink-2); font-size: 10px; font-weight: 700; }
.modal-actions { position: relative; z-index: 1; display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.modal-actions.split { justify-content: space-between; gap: 12px; }
.modal-actions.split > div { display: flex; gap: 6px; flex-wrap: wrap; }
.cookie-modal-head { position: relative; z-index: 1; display: flex; align-items: center; gap: 12px; padding-right: 38px; }
.cookie-modal-head > div { display: grid; gap: 2px; }
.cookie-area { min-height: 150px; font-family: var(--mono); font-size: 10px; line-height: 1.6; }
.cookie-security {
  position: relative; z-index: 1; display: flex; align-items: flex-start; gap: 9px; margin-top: 12px;
  padding: 10px 12px; border-radius: 12px; background: var(--gold-soft); color: #8f5f14;
}
.cookie-security span { line-height: 1; }
.cookie-security p { margin: 0; font-size: 9px; line-height: 1.6; }
.modal-enter-active, .modal-leave-active { transition: opacity .22s ease; }
.modal-enter-active .modal-card, .modal-leave-active .modal-card { transition: transform .28s cubic-bezier(.2,.8,.2,1), opacity .22s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal-card, .modal-leave-to .modal-card { opacity: 0; transform: translateY(16px) scale(.96); }

@media (max-width: 1280px) {
  .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .table-shell { overflow-x: auto; }
  .table-head, .data-row { min-width: 0; }
}
@media (max-width: 960px) {
  .admin-hero { grid-template-columns: 1fr; padding-bottom: 70px; }
  .hero-side { display: none; }
  .panel-toolbar { align-items: stretch; flex-direction: column; }
  .search, .search.compact, .search.wide { width: 100%; }
  .filter-group { width: 100%; }
  .filter-select { flex: 0 0 112px; }
}
@media (max-width: 680px) {
  .admin-hero { min-height: 330px; padding: 27px 23px 78px; border-radius: 23px; }
  .hero-main h3 { font-size: 37px; }
  .hero-main > p { font-size: 11px; }
  .provider-mix { left: 23px; right: 23px; gap: 9px; }
  .mix-item { min-width: calc(50% - 5px); }
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .console { padding: 17px; }
  .console-head { align-items: flex-start; }
  .console-clock { display: none; }
  .tabs { overflow-x: auto; }
  .tab { flex: 0 0 145px; }
  .filter-group { flex-direction: column; }
  .filter-select { width: 100%; flex-basis: auto; }
  .security-note { align-items: flex-start; }
  .modal-layer { padding: 10px; }
  .modal-card { padding: 21px; border-radius: 20px; }
  .modal-actions.split { flex-direction: column; }
  .modal-actions.split > div { width: 100%; }
  .modal-actions.split .btn { flex: 1; }
}
</style>
