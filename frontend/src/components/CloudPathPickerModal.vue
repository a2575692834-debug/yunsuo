<script setup>
import { computed, ref, watch } from 'vue'
import { api } from '../api.js'
import { fmtBytes } from '../format.js'
import { notify } from '../toast.js'

const props = defineProps({
  modelValue: Boolean,
  account: { type: Object, default: null },
  mode: { type: String, default: 'source' },
  title: { type: String, default: '选择网盘目录' },
  description: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'select'])

const path = ref('/')
const items = ref([])
const loading = ref(false)

const folders = computed(() => items.value.filter((item) => item.type === 'dir'))
const files = computed(() => props.mode === 'source'
  ? items.value.filter((item) => item.type !== 'dir')
  : [])
const crumbs = computed(() => {
  const out = [{ label: '根目录', path: '/' }]
  let current = ''
  for (const part of path.value.split('/').filter(Boolean)) {
    current += '/' + part
    out.push({ label: part, path: current })
  }
  return out
})
const confirmText = computed(() => props.mode === 'source' ? '同步整个文件夹' : '选择此目录')

function close() {
  emit('update:modelValue', false)
}

async function load(target = path.value) {
  if (!props.account) return
  path.value = target
  loading.value = true
  try {
    items.value = await api.get(`/accounts/${props.account.id}/files?path=${encodeURIComponent(target)}`)
  } catch (err) {
    notify(err.message, 'error')
    items.value = []
  } finally {
    loading.value = false
  }
}

function enter(folder) {
  load(folder.path)
}

function chooseFile(file) {
  emit('select', file.path)
  close()
}

function up() {
  const parts = path.value.split('/').filter(Boolean)
  parts.pop()
  load('/' + parts.join('/'))
}

function confirm() {
  emit('select', path.value)
  close()
}

watch(
  () => [props.modelValue, props.account?.id, props.mode],
  ([open]) => {
    if (open) load('/')
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="path-modal">
      <div v-if="modelValue" class="backdrop" @click.self="close">
        <section class="modal">
          <header class="modal-head">
            <div>
              <span class="mono eyebrow">{{ mode === 'source' ? 'SOURCE EXPLORER' : 'DESTINATION EXPLORER' }}</span>
              <h3 class="display">{{ title }}</h3>
              <p>{{ account?.label || '网盘账号' }}</p>
              <small v-if="description">{{ description }}</small>
            </div>
            <button class="close" @click="close">×</button>
          </header>

          <div class="pathbar">
            <button v-for="(crumb, index) in crumbs" :key="crumb.path" class="crumb" @click="load(crumb.path)">
              <span v-if="index" class="slash">/</span>{{ crumb.label }}
            </button>
          </div>

          <div class="explorer">
            <button v-if="path !== '/'" class="row parent" @click="up">
              <span class="row-icon">↑</span>
              <span class="row-copy"><strong>返回上一级</strong><small>{{ path }}</small></span>
            </button>

            <div v-if="loading" class="state">
              <span class="loader" />
              正在读取目录
            </div>
            <div v-else-if="!folders.length && !files.length" class="state">
              当前目录为空
            </div>

            <template v-else>
              <button
                v-for="(folder, index) in folders"
                :key="folder.path"
                class="row"
                :style="{ '--i': index }"
                @click="enter(folder)"
              >
                <span class="row-icon folder">▣</span>
                <span class="row-copy">
                  <strong>{{ folder.name }}</strong>
                  <small>文件夹</small>
                </span>
                <span class="row-action">进入 ›</span>
              </button>

              <button
                v-for="(file, index) in files"
                :key="file.path"
                class="row file-row"
                :style="{ '--i': folders.length + index }"
                @click="chooseFile(file)"
              >
                <span class="row-icon file">·</span>
                <span class="row-copy">
                  <strong>{{ file.name }}</strong>
                  <small>{{ fmtBytes(file.size) }}</small>
                </span>
                <span class="row-action sync">选择文件</span>
              </button>
            </template>
          </div>

          <footer class="modal-foot">
            <div class="current">
              <span class="mono">CURRENT</span>
              <strong>{{ path }}</strong>
            </div>
            <div class="actions">
              <button class="btn btn-ghost" @click="close">取消</button>
              <button class="btn btn-primary" :disabled="loading || !account" @click="confirm">{{ confirmText }}</button>
            </div>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(16, 24, 34, .54);
  backdrop-filter: blur(13px);
}
.modal {
  width: min(650px, 100%);
  max-height: min(760px, calc(100vh - 40px));
  display: grid;
  grid-template-rows: auto auto minmax(220px, 1fr) auto;
  gap: 14px;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, .34);
  border-radius: 28px;
  background:
    radial-gradient(300px 180px at 100% 0%, var(--gold-soft), transparent 72%),
    linear-gradient(180deg, #fffdf8, #f6f0e5);
  box-shadow: 0 42px 110px rgba(16, 24, 34, .4);
}
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.eyebrow { color: var(--coral); font-size: 8px; letter-spacing: .22em; }
.modal-head h3 { margin: 6px 0 3px; font-size: 27px; }
.modal-head p { margin: 0; color: var(--ink-2); font-size: 11px; }
.modal-head small { display: block; max-width: 440px; margin-top: 7px; color: var(--muted); font-size: 10px; line-height: 1.65; }
.close {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 29px;
  line-height: 1;
  cursor: pointer;
}
.close:hover { color: var(--coral); }
.pathbar {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  padding: 9px 11px;
  border: 1px solid var(--line-soft);
  border-radius: 14px;
  background: rgba(16, 24, 34, .04);
}
.crumb {
  flex: 0 0 auto;
  border: 0;
  padding: 4px 5px;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 10px;
  cursor: pointer;
}
.crumb:hover { background: rgba(16, 24, 34, .06); color: var(--ink); }
.slash { margin-right: 5px; color: rgba(16, 24, 34, .22); }
.explorer {
  display: grid;
  align-content: start;
  gap: 5px;
  min-height: 230px;
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--line-soft);
  border-radius: 18px;
  background: rgba(255, 253, 248, .68);
}
.row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 11px;
  border: 0;
  border-radius: 12px;
  padding: 10px 11px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  opacity: 0;
  transform: translateY(4px);
  animation: reveal .34s cubic-bezier(.2, .8, .2, 1) forwards;
  animation-delay: calc(var(--i, 0) * 25ms);
}
.row:hover { background: var(--gold-soft); transform: translateX(2px); }
.row.parent { color: var(--muted); }
.row-icon {
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--gold-soft);
  color: var(--gold);
  font-size: 14px;
}
.row-icon.folder { background: var(--teal-soft); color: var(--teal); }
.row-icon.file { background: var(--coral-soft); color: var(--coral); font-size: 24px; line-height: 1; }
.row-copy { flex: 1; min-width: 0; display: grid; gap: 2px; }
.row-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.row-copy small { color: var(--muted); font-size: 9px; }
.row-action { color: rgba(16, 24, 34, .3); font-size: 10px; }
.row-action.sync { color: var(--coral); font-weight: 700; }
.state {
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: var(--muted);
  font-size: 12px;
}
.loader {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(16, 24, 34, .12);
  border-top-color: var(--coral);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
.modal-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}
.current { min-width: 0; display: grid; gap: 3px; }
.current span { color: var(--muted); font-size: 7px; letter-spacing: .18em; }
.current strong { max-width: 310px; color: var(--teal); font-family: var(--mono); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; gap: 8px; }
@keyframes spin { to { transform: rotate(360deg); } }
.path-modal-enter-active, .path-modal-leave-active { transition: opacity .24s ease; }
.path-modal-enter-active .modal, .path-modal-leave-active .modal { transition: opacity .24s ease, transform .34s cubic-bezier(.2, .9, .2, 1); }
.path-modal-enter-from, .path-modal-leave-to { opacity: 0; }
.path-modal-enter-from .modal, .path-modal-leave-to .modal { opacity: 0; transform: translateY(18px) scale(.96); }
@media (max-width: 620px) {
  .modal { padding: 19px; border-radius: 22px; }
  .modal-foot { align-items: stretch; flex-direction: column; }
  .actions .btn { flex: 1; }
  .current strong { max-width: 100%; }
}
</style>
