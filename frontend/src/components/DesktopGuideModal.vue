<script setup>
import { ref } from 'vue'

defineProps({
  modelValue: Boolean
})

const emit = defineEmits(['update:modelValue'])

const serverUrl = window.location.origin
const downloadUrl = import.meta.env.VITE_DESKTOP_DOWNLOAD_URL || '/downloads/YunsuoDesktop-1.1.1.exe'
const copied = ref('')

function close() {
  emit('update:modelValue', false)
}

function fallbackCopy(value) {
  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  const success = document.execCommand('copy')
  field.remove()
  return success
}

async function copy(value, key) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    if (!fallbackCopy(value)) return
  }
  copied.value = key
  setTimeout(() => { copied.value = '' }, 1600)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="desktop-guide">
      <div v-if="modelValue" class="backdrop" @click.self="close">
        <div class="guide">
          <aside class="guide-rail">
            <div class="rail-head">
              <span class="mono tiny">WINDOWS / PORTABLE</span>
              <button class="close" title="关闭" @click="close">×</button>
            </div>

            <div class="desktop-orbit" aria-hidden="true">
              <i />
              <i />
              <i />
              <span>梭</span>
            </div>

            <div class="rail-copy">
              <span class="edition">云梭桌面端 · v1.1.1</span>
              <h3 class="display">完整云梭，<br>登录一次就上桌。</h3>
              <p>站内账号登录，Token 加密保存。转存、空间、分享、监控与后台，一个桌面窗口全部完成。</p>
            </div>

            <a class="download" :href="downloadUrl" target="_blank" rel="noopener" @click="copied = 'download'">
              <span class="download-mark">↓</span>
              <span>
                <strong>{{ copied === 'download' ? '已开始下载' : '下载 Windows 客户端' }}</strong>
                <small>Windows x64 · 便携版 · 约 105 MB</small>
              </span>
            </a>

            <div class="rail-note">
              <span class="status-dot" />
              <span>无需安装，下载后直接运行</span>
            </div>
          </aside>

          <section class="guide-body">
            <div class="body-head">
              <div>
                <span class="eyebrow mono">QUICK START</span>
                <h4 class="display">三步连接你的云梭</h4>
              </div>
                <span class="version mono">FULL MODE</span>
            </div>

            <div class="steps">
              <article class="step">
                <span class="step-no mono">01</span>
                <div class="step-copy">
                  <strong>下载并运行客户端</strong>
                  <p>首次打开若出现 Windows SmartScreen，选择“更多信息”后点击“仍要运行”。</p>
                </div>
              </article>

              <article class="step">
                <span class="step-no mono">02</span>
                <div class="step-copy">
                  <strong>填写登录地址、账号和密码</strong>
                  <p>使用当前站点地址和云梭账号密码登录。默认直接登录，也可开启「登录前验证服务器」先检查连通性。</p>
                  <div class="copy-fields">
                    <div class="copy-field">
                      <span class="mono">{{ serverUrl }}</span>
                      <button @click="copy(serverUrl, 'server')">
                        {{ copied === 'server' ? '已复制' : '复制地址' }}
                      </button>
                    </div>
                  </div>
                </div>
              </article>

              <article class="step">
                <span class="step-no mono">03</span>
                <div class="step-copy">
                  <strong>登录后直接进入完整版</strong>
                  <p>Token 自动加密同步，下次启动免登录；本地监控由桌面端在线时自动执行。</p>
                </div>
              </article>
            </div>

            <div class="tip">
              <span class="tip-mark">!</span>
              <div>
                <strong>Token 只加密保存在你的电脑</strong>
                <p>桌面端不会保存站点密码，也不会保存百度、夸克、迅雷 Cookie；网盘账号与凭据仍由服务端加密管理。</p>
              </div>
            </div>

            <div class="body-actions">
              <a class="text-link" :href="downloadUrl" target="_blank" rel="noopener">重新下载</a>
              <button class="btn btn-primary" @click="close">我知道了</button>
            </div>
          </section>
        </div>
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
  padding: 22px;
  background: rgba(16, 24, 34, .58);
  backdrop-filter: blur(14px);
}
.guide {
  width: min(920px, 100%);
  max-height: min(760px, calc(100vh - 44px));
  display: grid;
  grid-template-columns: minmax(300px, .82fr) minmax(0, 1.18fr);
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.34);
  border-radius: 30px;
  background: #fffdf8;
  box-shadow: 0 40px 120px rgba(16,24,34,.42);
}
.guide-rail {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 25px;
  color: #f7f0e4;
  background:
    radial-gradient(360px 260px at 92% 4%, rgba(239,84,56,.32), transparent 64%),
    radial-gradient(280px 220px at 8% 80%, rgba(15,118,110,.34), transparent 70%),
    linear-gradient(155deg, #162431, #0b131b 58%, #111d24);
}
.guide-rail::after {
  content: "";
  position: absolute;
  width: 280px;
  height: 280px;
  right: -190px;
  bottom: -130px;
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 50%;
  box-shadow: 0 0 0 34px rgba(255,255,255,.025), 0 0 0 68px rgba(255,255,255,.018);
  pointer-events: none;
}
.rail-head { display: flex; align-items: center; justify-content: space-between; }
.rail-head .tiny { color: rgba(247,240,228,.48); font-size: 8px; letter-spacing: .22em; }
.close {
  position: relative;
  z-index: 2;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 50%;
  background: rgba(255,255,255,.05);
  color: rgba(255,255,255,.65);
  font-size: 21px;
  line-height: 1;
  cursor: pointer;
}
.close:hover { background: rgba(239,84,56,.2); color: #fff; }
.desktop-orbit {
  position: relative;
  width: 122px;
  height: 122px;
  display: grid;
  place-items: center;
  margin: 34px auto 27px;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 50%;
  box-shadow: 0 0 0 18px rgba(255,255,255,.026), 0 0 0 36px rgba(255,255,255,.016);
}
.desktop-orbit span {
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
  border-radius: 24px;
  background: linear-gradient(135deg, var(--coral), #c93a22);
  box-shadow: 0 20px 42px rgba(239,84,56,.35);
  font-family: var(--display);
  font-size: 34px;
}
.desktop-orbit i { position: absolute; border-radius: 50%; }
.desktop-orbit i:nth-child(1) { width: 9px; height: 9px; left: -5px; top: 54px; background: var(--gold); }
.desktop-orbit i:nth-child(2) { width: 7px; height: 7px; right: 8px; top: 18px; background: var(--teal); }
.desktop-orbit i:nth-child(3) { width: 5px; height: 5px; right: 18px; bottom: 9px; background: #f7f0e4; }
.rail-copy { position: relative; z-index: 1; }
.edition {
  display: inline-flex;
  padding: 5px 9px;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 999px;
  color: rgba(247,240,228,.62);
  font-size: 9px;
  letter-spacing: .08em;
}
.rail-copy h3 { margin: 13px 0 10px; font-size: clamp(29px, 3.3vw, 42px); line-height: 1.1; font-weight: 500; }
.rail-copy p { margin: 0; max-width: 300px; color: rgba(247,240,228,.55); font-size: 11px; line-height: 1.8; }
.download {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 27px;
  padding: 12px 14px;
  border-radius: 17px;
  background: #f7f0e4;
  color: #101822;
  text-decoration: none;
  transition: transform .22s, box-shadow .22s;
}
.download:hover { transform: translateY(-2px); box-shadow: 0 16px 35px rgba(0,0,0,.24); }
.download-mark {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--coral);
  color: #fff;
  font-size: 18px;
  font-weight: 800;
}
.download > span:last-child { display: grid; gap: 3px; min-width: 0; }
.download strong { font-size: 12px; }
.download small { color: rgba(16,24,34,.5); font-size: 8px; letter-spacing: .05em; }
.rail-note {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: auto;
  padding-top: 19px;
  color: rgba(247,240,228,.45);
  font-size: 9px;
}
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: #5cc4a9; box-shadow: 0 0 12px #5cc4a9; }
.guide-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-y: auto;
  padding: 30px 31px 24px;
  background:
    radial-gradient(320px 220px at 100% 0%, rgba(217,154,50,.1), transparent 68%),
    linear-gradient(180deg, #fffdf8, #f8f3e9);
}
.body-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.eyebrow { color: var(--coral); font-size: 8px; letter-spacing: .2em; }
.body-head h4 { margin: 7px 0 0; font-size: 28px; }
.version { padding-top: 5px; color: rgba(16,24,34,.28); font-size: 8px; letter-spacing: .14em; }
.steps { display: grid; gap: 7px; margin-top: 22px; }
.step {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 13px;
  padding: 14px;
  border: 1px solid rgba(16,24,34,.075);
  border-radius: 17px;
  background: rgba(255,253,248,.65);
}
.step-no {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: rgba(15,118,110,.09);
  color: var(--teal);
  font-size: 9px;
  font-weight: 800;
}
.step:nth-child(2) .step-no { background: rgba(239,84,56,.09); color: var(--coral); }
.step:nth-child(3) .step-no { background: rgba(217,154,50,.14); color: #986816; }
.step-copy { min-width: 0; }
.step-copy strong { font-size: 12px; }
.step-copy p { margin: 5px 0 0; color: var(--muted); font-size: 10px; line-height: 1.7; }
.copy-fields { display: grid; gap: 7px; margin-top: 10px; }
.copy-field {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 8px 7px 10px;
  border: 1px solid var(--line-soft);
  border-radius: 11px;
  background: #fff;
}
.copy-field span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 9px; }
.copy-field button {
  flex: 0 0 auto;
  border: 0;
  border-radius: 8px;
  padding: 5px 8px;
  background: var(--ink-soft);
  color: var(--ink);
  font-size: 9px;
  cursor: pointer;
}
.copy-token {
  justify-self: start;
  border: 1px solid rgba(239,84,56,.2);
  border-radius: 9px;
  padding: 7px 10px;
  background: var(--coral-soft);
  color: var(--coral);
  font-size: 9px;
  font-weight: 800;
  cursor: pointer;
}
.tip {
  display: flex;
  gap: 11px;
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 15px;
  background: rgba(16,24,34,.045);
}
.tip-mark {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--gold-soft);
  color: #8d5f13;
  font-size: 11px;
  font-weight: 900;
}
.tip strong { display: block; font-size: 10px; }
.tip p { margin: 3px 0 0; color: var(--muted); font-size: 9px; line-height: 1.65; }
.body-actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: auto; padding-top: 20px; }
.text-link { color: var(--muted); font-size: 10px; text-underline-offset: 3px; }
.text-link:hover { color: var(--coral); }
.desktop-guide-enter-active, .desktop-guide-leave-active { transition: opacity .24s ease; }
.desktop-guide-enter-active .guide, .desktop-guide-leave-active .guide {
  transition: transform .38s cubic-bezier(.2,.9,.2,1), opacity .24s;
}
.desktop-guide-enter-from, .desktop-guide-leave-to { opacity: 0; }
.desktop-guide-enter-from .guide, .desktop-guide-leave-to .guide { opacity: 0; transform: translateY(22px) scale(.95); }
@media (max-width: 760px) {
  .backdrop { padding: 10px; }
  .guide {
    max-height: calc(100vh - 20px);
    grid-template-columns: 1fr;
    overflow-y: auto;
    border-radius: 24px;
  }
  .guide-rail { min-height: 330px; padding: 21px; }
  .desktop-orbit { width: 92px; height: 92px; margin: 18px auto 20px; }
  .desktop-orbit span { width: 56px; height: 56px; border-radius: 19px; font-size: 27px; }
  .rail-copy h3 { font-size: 30px; }
  .rail-copy p { display: none; }
  .download { margin-top: 18px; }
  .rail-note { margin-top: 16px; }
  .guide-body { overflow: visible; padding: 23px 19px 19px; }
  .body-head h4 { font-size: 24px; }
}
</style>
