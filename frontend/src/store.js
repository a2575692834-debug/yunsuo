import { reactive } from 'vue'

const THEME_KEY = 'ys_theme'

export const themes = [
  {
    id: 'cloud',
    name: '云笺',
    description: '米白 · 珊瑚 · 青绿',
    colors: ['#f3ede2', '#ef5438', '#0f766e']
  },
  {
    id: 'sea',
    name: '海盐',
    description: '雾蓝 · 海松 · 琥珀',
    colors: ['#e9f1f2', '#147d92', '#d8a543']
  },
  {
    id: 'terra',
    name: '赤陶',
    description: '陶粉 · 赭红 · 鼠尾草',
    colors: ['#f1e5db', '#bd4d2d', '#657a50']
  },
  {
    id: 'moss',
    name: '苔原',
    description: '苔纸 · 苔绿 · 暖金',
    colors: ['#e9ede3', '#446b4a', '#b88b3d']
  }
]

function readTheme() {
  const saved = localStorage.getItem(THEME_KEY)
  return themes.some((theme) => theme.id === saved) ? saved : 'cloud'
}

const readUser = () => {
  try { return JSON.parse(localStorage.getItem('ys_user') || 'null') } catch { return null }
}

export const store = reactive({
  token: localStorage.getItem('ys_token') || '',
  user: readUser(),
  theme: readTheme(),
  page: 'dashboard',
  providers: [],
  accounts: [],
  activeAccountId: '',
  overview: null,
  booted: false
})

export function setTheme(id) {
  const theme = themes.some((item) => item.id === id) ? id : 'cloud'
  store.theme = theme
  document.documentElement.dataset.theme = theme
  localStorage.setItem(THEME_KEY, theme)
}

if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = store.theme
}

export function setSession(token, user) {
  store.token = token
  store.user = user
  localStorage.setItem('ys_token', token)
  localStorage.setItem('ys_user', JSON.stringify(user))
}

export function clearSession() {
  store.token = ''
  store.user = null
  store.providers = []
  store.accounts = []
  store.activeAccountId = ''
  store.overview = null
  localStorage.removeItem('ys_token')
  localStorage.removeItem('ys_user')
}
