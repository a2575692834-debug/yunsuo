<script setup>
import { computed, ref, watch } from 'vue'
import { api } from '../api.js'
import { notify } from '../toast.js'

const props = defineProps({
  modelValue: Boolean,
  account: { type: Object, default: null },
  title: { type: String, default: '选择转存目录' },
  eyebrow: { type: String, default: 'CHOOSE FOLDER' },
  description: { type: String, default: '' },
  confirmText: { type: String, default: '选择此目录' },
  disabledPaths: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'select'])

const path = ref('/')
const files = ref([])
const loading = ref(false)

const folders = computed(() => files.value.filter((item) => item.type === 'dir'))
const blockedPaths = computed(() => new Set(props.disabledPaths.map((item) => String(item || '/').replace(/\/+$/, '') || '/')))
const currentBlocked = computed(() => isBlocked(path.value))
const crumbs = computed(() => {
  const out = [{ label: '根目录', path: '/' }]
  let current = ''
  for (const part of path.value.split('/').filter(Boolean)) {
    current += '/' + part
    out.push({ label: part, path: current })
  }
  return out
})

function isBlocked(folderPath) {
  const target = String(folderPath || '/').replace(/\/+$/, '') || '/'
  for (const blocked of blockedPaths.value) {
    if (target === blocked || target.startsWith(blocked + '/')) return true
  }
  return false
}

function close() {
  emit('update:modelValue', false)
}

async function load(target = path.value) {
  if (!props.account) return
  path.value = target
  loading.value = true
  try {
    files.value = await api.get(`/accounts/${props.account.id}/files?path=${encodeURIComponent(target)}`)
  } catch (err) {
    notify(err.message, 'error')
    files.value = []
  } finally {
    loading.value = false
  }
}

function enter(folder) {
  load(folder.path)
}

function up() {
  const parts = path.value.split('/').filter(Boolean)
  parts.pop()
  load('/' + parts.join('/'))
}

function confirm() {
  if (currentBlocked.value) return
  emit('select', path.value)
  close()
}

watch(
  () => [props.modelValue, props.account?.id],
  ([open]) => {
    if (open) load('/')
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="folder-modal">
      <div v-if="modelValue" class="backdrop" @click.self="close">
        <div class="modal">
          <div class="modal-head">
            <div>
              <div class="tiny muted">{{ eyebrow }}</div>
              <h3 class="display">{{ title }}</h3>
              <p class="account-note">{{ account?.label || '网盘账号' }}</p>
              <p v-if="description" class="account-description">{{ description }}</p>
            </div>
            <button class="close" @click="close">×</button>
          </div>

          <div class="pathbar">
            <button class="crumb" @click="load('/')">根目录</button>
            <template v-for="crumb in crumbs.slice(1)" :key="crumb.path">
              <span>/</span>
              <button class="crumb" @click="load(crumb.path)">{{ crumb.label }}</button>
            </template>
          </div>

          <div class="folder-list">
            <button v-if="path !== '/'" class="folder-row parent" @click="up">
              <span class="folder-icon">↑</span>
              <span>返回上一级</span>
            </button>
            <div v-if="loading" class="state">正在读取目录…</div>
            <div v-else-if="!folders.length" class="state">当前目录没有子文件夹</div>
            <button
              v-for="(folder, index) in folders"
              :key="folder.path"
              class="folder-row"
              :class="{ blocked: isBlocked(folder.path) }"
              :style="{ '--i': index }"
              :disabled="isBlocked(folder.path)"
              @click="enter(folder)"
            >
              <span class="folder-icon">{{ isBlocked(folder.path) ? '×' : '▣' }}</span>
              <span class="folder-name">{{ folder.name }}</span>
              <span class="arrow">{{ isBlocked(folder.path) ? '不可选择' : '›' }}</span>
            </button>
          </div>

          <div class="selected">
            <span class="tiny muted">当前目录</span>
            <strong class="mono">{{ path }}</strong>
            <small v-if="currentBlocked">此目录包含待操作项目，不能作为目标目录</small>
          </div>

          <div class="modal-actions">
            <button class="btn btn-ghost" @click="close">取消</button>
            <button class="btn btn-primary" :disabled="loading || !account || currentBlocked" @click="confirm">{{ confirmText }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 210;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(16, 24, 34, .5);
  backdrop-filter: blur(12px);
}
.modal {
  width: min(560px, 100%);
  max-height: min(720px, calc(100vh - 40px));
  display: grid;
  grid-template-rows: auto auto minmax(170px, 1fr) auto auto;
  gap: 14px;
  padding: 24px;
  border: 1px solid rgba(255,255,255,.35);
  border-radius: 26px;
  background: linear-gradient(180deg, #fffdf8, #f6f0e5);
  box-shadow: 0 40px 100px rgba(16, 24, 34, .36);
}
.modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.modal-head h3 { margin: 4px 0 0; font-size: 26px; }
.account-note { margin: 5px 0 0; color: var(--muted); font-size: 11px; }
.account-description { max-width: 390px; margin: 6px 0 0; color: var(--muted); font-size: 10px; line-height: 1.65; }
.close {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 28px;
  line-height: 1;
  padding: 0 3px;
  cursor: pointer;
}
.close:hover { color: var(--coral); }
.pathbar {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow-x: auto;
  padding: 8px 10px;
  border-radius: 13px;
  background: rgba(16, 24, 34, .045);
}
.pathbar > span { color: rgba(16, 24, 34, .25); font-size: 10px; }
.crumb {
  border: 0;
  border-radius: 7px;
  padding: 4px 5px;
  background: transparent;
  color: var(--muted);
  font-size: 10px;
  white-space: nowrap;
  cursor: pointer;
}
.crumb:hover { color: var(--ink); background: rgba(16, 24, 34, .06); }
.folder-list {
  display: grid;
  align-content: start;
  gap: 5px;
  min-height: 190px;
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background: rgba(255, 253, 248, .64);
}
.folder-row {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  border: 0;
  border-radius: 11px;
  padding: 10px 11px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  opacity: 0;
  animation: reveal .36s cubic-bezier(.2,.8,.2,1) forwards;
  animation-delay: calc(var(--i, 0) * 28ms);
}
.folder-row:hover { background: var(--gold-soft); transform: translateX(2px); }
.folder-row.blocked { opacity: .46; cursor: not-allowed; background: rgba(16, 24, 34, .03); }
.folder-row.blocked:hover { transform: none; }
.folder-row.parent { color: var(--muted); font-size: 11px; }
.folder-icon {
  width: 31px;
  height: 31px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--gold-soft);
  color: var(--gold);
  font-size: 13px;
}
.folder-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.arrow { color: rgba(16, 24, 34, .25); font-size: 19px; }
.state { padding: 54px 14px; color: var(--muted); text-align: center; font-size: 12px; }
.selected {
  display: grid;
  gap: 5px;
  padding: 11px 13px;
  border-radius: 13px;
  background: var(--teal-soft);
}
.selected strong { color: var(--teal); font-size: 11px; overflow-wrap: anywhere; }
.selected small { color: #b42318; font-size: 9px; line-height: 1.5; }
.modal-actions { display: flex; justify-content: flex-end; gap: 9px; }
.folder-modal-enter-active, .folder-modal-leave-active { transition: opacity .25s ease; }
.folder-modal-enter-active .modal, .folder-modal-leave-active .modal {
  transition: transform .34s cubic-bezier(.2,.9,.2,1), opacity .25s;
}
.folder-modal-enter-from, .folder-modal-leave-to { opacity: 0; }
.folder-modal-enter-from .modal, .folder-modal-leave-to .modal { opacity: 0; transform: translateY(18px) scale(.95); }
@media (max-width: 560px) {
  .modal { padding: 19px; border-radius: 22px; }
  .modal-actions .btn { flex: 1; }
}
</style>
