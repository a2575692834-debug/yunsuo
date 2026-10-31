<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { api } from '../api.js'
import { notify } from '../toast.js'

const props = defineProps({
  modelValue: Boolean,
  provider: { type: Object, default: null },
  suggestedLabel: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'success'])

const qr = ref(null)
const status = ref('')
const busy = ref(false)
const cookie = ref('')
const label = ref('')
const imageFailed = ref(false)
let timer = null

const title = computed(() => props.provider ? `登录 ${props.provider.name}` : '登录网盘')
const qrImage = computed(() => {
  const src = String(qr.value?.qrImage || '').trim()
  if (!src) return ''
  if (/^(data:|blob:|https?:\/\/)/i.test(src)) return src
  return `https://${src.replace(/^\/\//, '')}`
})

function close() {
  stop()
  emit('update:modelValue', false)
}

function stop() {
  clearTimeout(timer)
  timer = null
}

async function start() {
  stop()
  qr.value = null
  cookie.value = ''
  imageFailed.value = false
  status.value = '正在获取二维码…'
  if (!props.provider) return
  try {
    const data = await api.post(`/providers/${props.provider.id}/qr/start`)
    qr.value = data
    status.value = qrImage.value ? '请使用对应 App 扫码' : '演示空间会自动确认'
    poll(data.token)
  } catch (err) {
    status.value = err.message
  }
}

function onImageError() {
  imageFailed.value = true
  status.value = '二维码加载失败,请刷新重试'
}

async function poll(token) {
  try {
    const data = await api.get(`/providers/${props.provider.id}/qr/poll?token=${encodeURIComponent(token)}`)
    if (data.status === 'confirmed') {
      status.value = '登录成功'
      stop()
      notify(`${props.provider.name} 已连接`, 'success')
      emit('success', data.accountId)
      setTimeout(close, 500)
      return
    }
    if (data.status === 'expired') {
      status.value = '二维码已过期,请刷新'
      return
    }
    if (data.status === 'scanned') {
      status.value = '已扫码,请在手机上确认登录'
    }
    timer = setTimeout(() => poll(token), 2000)
  } catch (err) {
    status.value = err.message
  }
}

async function saveCookie() {
  if (!cookie.value.trim()) return notify('请先粘贴 Cookie', 'error')
  busy.value = true
  try {
    await api.post('/accounts', {
      provider: props.provider.id,
      label: label.value || props.provider.name,
      cookie: cookie.value.trim()
    })
    notify('账号已保存', 'success')
    emit('success')
    close()
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    busy.value = false
  }
}

watch(
  () => [props.modelValue, props.provider?.id],
  ([open]) => {
    if (open) {
      label.value = props.suggestedLabel || props.provider?.name || ''
      start()
    } else {
      stop()
    }
  }
)

onUnmounted(stop)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="backdrop" @click.self="close">
        <div class="modal">
          <div class="modal-head">
            <div>
              <div class="tiny muted">SECURE SIGN-IN</div>
              <h3 class="display">{{ title }}</h3>
            </div>
            <button class="x" @click="close">×</button>
          </div>

          <div class="multi-note">
            <span class="mono">MULTI</span>
            同一平台可添加多个账号；每个 Cookie 独立加密保存，可随时继续添加。
          </div>

          <div class="qr-stage">
            <div class="qr-frame" :class="{ ready: qrImage && !imageFailed }">
              <img v-if="qrImage && !imageFailed" :src="qrImage" alt="登录二维码" @error="onImageError" />
              <div v-else class="qr-wait">
                <span class="ring r1" />
                <span class="ring r2" />
                <span class="ring r3" />
                <strong>{{ status }}</strong>
              </div>
              <span v-if="qrImage && !imageFailed" class="scanline" />
            </div>
            <p class="status">{{ status }}</p>
          </div>

          <div class="divider"><span>或手动填写 Cookie</span></div>

          <div class="field">
            <label>账号备注</label>
            <input v-model="label" class="input" placeholder="例如:主账号" />
          </div>
          <div class="field" style="margin-top:12px">
            <label>Cookie</label>
            <textarea v-model="cookie" class="textarea" rows="3" placeholder="粘贴已登录状态的 Cookie 字符串" />
          </div>

          <div class="modal-actions">
            <button class="btn btn-ghost" @click="start">刷新二维码</button>
            <button class="btn btn-primary" :disabled="busy" @click="saveCookie">保存 Cookie</button>
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
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(16, 24, 34, .45);
  backdrop-filter: blur(10px);
}
.modal {
  width: min(460px, 100%);
  border-radius: 26px;
  border: 1px solid rgba(255,255,255,.35);
  background: linear-gradient(180deg, #fffdf8, #f6f0e5);
  box-shadow: 0 40px 100px rgba(16, 24, 34, .35);
  padding: 24px;
}
.modal-head { display: flex; align-items: flex-start; justify-content: space-between; }
.modal-head h3 { margin: 4px 0 0; font-size: 24px; }
.multi-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding: 9px 11px;
  border: 1px solid rgba(15, 118, 110, .14);
  border-radius: 12px;
  background: rgba(216, 240, 236, .58);
  color: #48655f;
  font-size: 10px;
  line-height: 1.5;
}
.multi-note span {
  flex: 0 0 auto;
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--teal);
  color: #fff;
  font-size: 7px;
  letter-spacing: .08em;
}
.x {
  border: 0; background: transparent; font-size: 26px; line-height: 1;
  cursor: pointer; color: var(--muted); padding: 0 4px;
}
.qr-stage { display: grid; justify-items: center; gap: 12px; padding: 18px 0 8px; }
.qr-frame {
  position: relative;
  width: 236px;
  height: 236px;
  border-radius: 22px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--line);
  box-shadow: inset 0 0 0 7px #f8f3e9;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.qr-frame img { width: 100%; height: 100%; object-fit: contain; border-radius: 10px; }
.scanline {
  position: absolute; left: 16px; right: 16px; height: 2px; border-radius: 999px;
  background: linear-gradient(90deg, transparent, var(--coral), transparent);
  animation: scan 2.4s ease-in-out infinite;
}
.qr-wait { position: relative; display: grid; place-items: center; width: 100%; height: 100%; }
.qr-wait strong { position: relative; z-index: 2; font-size: 13px; color: var(--muted); text-align: center; }
.ring { position: absolute; border-radius: 999px; border: 1.5px solid rgba(239, 84, 56, .35); }
.r1 { width: 80px; height: 80px; animation: spin-slow 8s linear infinite; }
.r2 { width: 130px; height: 130px; border-color: rgba(15, 118, 110, .28); animation: spin-slow 12s linear infinite reverse; }
.r3 { width: 190px; height: 190px; border-color: rgba(217, 154, 50, .25); animation: spin-slow 18s linear infinite; }
.status { margin: 0; font-size: 13px; color: var(--muted); }
.divider { display: flex; align-items: center; gap: 12px; margin: 14px 0; color: var(--muted); font-size: 11px; }
.divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.modal-enter-active, .modal-leave-active { transition: opacity .3s ease; }
.modal-enter-active .modal, .modal-leave-active .modal { transition: transform .38s cubic-bezier(.2,.9,.2,1), opacity .3s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal, .modal-leave-to .modal { opacity: 0; transform: translateY(22px) scale(.94) rotate(-1.5deg); }
</style>
