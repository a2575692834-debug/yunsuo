<script setup>
import { ref } from 'vue'
import { api } from '../api.js'
import { setSession } from '../store.js'
import { notify } from '../toast.js'

const emit = defineEmits(['success'])
const mode = ref('login')
const form = ref({ username: '', password: '' })
const busy = ref(false)

async function submit() {
  if (!form.value.username || !form.value.password) {
    return notify('请输入用户名和密码', 'error')
  }
  busy.value = true
  try {
    const data = await api.post(mode.value === 'login' ? '/auth/login' : '/auth/register', form.value)
    setSession(data.token, data.user)
    notify(mode.value === 'login' ? '欢迎回来' : '账号创建成功', 'success')
    emit('success')
  } catch (err) {
    notify(err.message, 'error')
  } finally {
    busy.value = false
  }
}

function switchMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  form.value.password = ''
}
</script>

<template>
  <div class="auth">
    <section class="art">
      <div class="aurora a1" />
      <div class="aurora a2" />
      <div class="aurora a3" />

      <div class="brand">
        <span class="seal">梭</span>
        <span class="brand-cn display">云梭</span>
        <span class="brand-en mono">YUNSUO</span>
      </div>

      <div class="art-copy">
        <div class="eyebrow">NETDISK SHUTTLE · 多用户版</div>
        <h1 class="display">把链接,<br /><em>折叠</em>进你的云端。</h1>
        <p>识别百度、夸克、迅雷分享链接,转存到自己的网盘,再一键分享出去。每个人,都有自己的云。</p>
      </div>

      <div class="orbit">
        <span class="ring ring-a" />
        <span class="ring ring-b" />
        <span class="ring ring-c" />
        <span class="node n1">百度</span>
        <span class="node n2">夸克</span>
        <span class="node n3">迅雷</span>
        <span class="core display">转存<br /><small>SHARE</small></span>
      </div>

      <div class="marquee mono">
        <span>REGEX PARSE</span><i />
        <span>QR LOGIN</span><i />
        <span>MYSQL</span><i />
        <span>TRANSFER</span><i />
        <span>SHARE</span>
      </div>
    </section>

    <section class="panel">
      <div class="form-card">
        <div class="tabs">
          <button :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
          <button :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
          <span class="tab-ink" :class="{ right: mode === 'register' }" />
        </div>

        <div class="form-title">
          <h2 class="display">{{ mode === 'login' ? '欢迎回来' : '创建你的云梭' }}</h2>
          <p class="muted">{{ mode === 'login' ? '继续管理你的转存任务与分享' : '注册后即可添加自己的网盘账号' }}</p>
        </div>

        <form @submit.prevent="submit">
          <div class="field">
            <label>用户名</label>
            <input v-model="form.username" class="input" autocomplete="username" placeholder="3-32 个字符" />
          </div>
          <div class="field" style="margin-top:16px">
            <label>密码</label>
            <input v-model="form.password" class="input" type="password" autocomplete="current-password" placeholder="至少 6 位" />
          </div>
          <button class="btn btn-primary submit" :disabled="busy">
            {{ busy ? '请稍候…' : mode === 'login' ? '进入云梭' : '注册并进入' }}
          </button>
        </form>

        <p class="switch">
          {{ mode === 'login' ? '还没有账号？' : '已经有账号？' }}
          <button @click="switchMode">{{ mode === 'login' ? '创建一个' : '去登录' }}</button>
        </p>
      </div>

      <div class="panel-foot mono">PRIVATE SPACE · YOUR LINKS, YOUR CLOUD</div>
    </section>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1.15fr .85fr;
  background: var(--ink);
  color: #f6f0e5;
}
.art {
  position: relative;
  overflow: hidden;
  padding: 46px 56px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 720px;
  background:
    radial-gradient(700px 500px at 18% 18%, rgba(239,84,56,.22), transparent 60%),
    radial-gradient(600px 500px at 80% 70%, rgba(15,118,110,.28), transparent 62%),
    linear-gradient(160deg, #121b28, #0c131d 70%);
}
.aurora { position: absolute; border-radius: 50%; filter: blur(50px); opacity: .5; pointer-events: none; }
.a1 { width: 340px; height: 340px; background: rgba(239,84,56,.55); top: 4%; left: -6%; animation: drift 16s ease-in-out infinite; }
.a2 { width: 300px; height: 300px; background: rgba(15,118,110,.55); bottom: 8%; right: 2%; animation: drift 20s ease-in-out infinite reverse; }
.a3 { width: 200px; height: 200px; background: rgba(217,154,50,.4); top: 42%; left: 52%; animation: drift 24s ease-in-out infinite; }
.brand { position: relative; z-index: 2; display: flex; align-items: center; gap: 12px; }
.seal {
  width: 40px; height: 40px; border-radius: 13px; display: grid; place-items: center;
  background: linear-gradient(135deg, var(--coral), #c93a22);
  font-family: var(--display); font-size: 20px; color: #fff;
  box-shadow: 0 12px 26px rgba(239,84,56,.35);
}
.brand-cn { font-size: 22px; letter-spacing: .08em; }
.brand-en { font-size: 10px; letter-spacing: .3em; color: rgba(246,240,229,.55); }
.art-copy { position: relative; z-index: 2; max-width: 620px; }
.art-copy .eyebrow { color: rgba(246,240,229,.55); }
.art-copy h1 { font-size: clamp(46px, 5.2vw, 82px); line-height: 1.08; margin: 20px 0; font-weight: 700; }
.art-copy h1 em { color: var(--coral); font-style: normal; position: relative; }
.art-copy h1 em::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 6px; height: 10px;
  background: rgba(239,84,56,.25); z-index: -1; transform: skewX(-12deg);
}
.art-copy p { max-width: 500px; color: rgba(246,240,229,.62); line-height: 1.9; font-size: 15px; }
.orbit { position: absolute; right: 6%; top: 18%; width: 330px; height: 330px; z-index: 1; opacity: .9; }
.ring { position: absolute; inset: 0; border-radius: 50%; border: 1px solid rgba(246,240,229,.16); }
.ring-b { inset: 42px; border-color: rgba(239,84,56,.28); animation: spin-slow 24s linear infinite; }
.ring-c { inset: 84px; border-style: dashed; border-color: rgba(15,118,110,.4); animation: spin-slow 18s linear infinite reverse; }
.core {
  position: absolute; inset: 0; margin: auto; width: 126px; height: 126px; border-radius: 50%;
  display: grid; place-items: center; text-align: center; font-size: 22px; line-height: 1.2;
  background: radial-gradient(circle at 30% 20%, rgba(255,255,255,.16), rgba(255,255,255,.03));
  border: 1px solid rgba(246,240,229,.2); backdrop-filter: blur(8px);
  animation: float 7s ease-in-out infinite;
}
.core small { font-family: var(--mono); font-size: 8px; letter-spacing: .26em; color: rgba(246,240,229,.5); }
.node {
  position: absolute; padding: 8px 14px; border-radius: 999px; font-size: 12px; font-weight: 700;
  background: rgba(246,240,229,.08); border: 1px solid rgba(246,240,229,.18);
  backdrop-filter: blur(6px); animation: float 6s ease-in-out infinite;
}
.n1 { top: -8px; left: 38%; color: #ffb4a3; animation-delay: -1s; }
.n2 { right: -12px; top: 46%; color: #8fe0d6; animation-delay: -3s; }
.n3 { bottom: 4px; left: 18%; color: #f3cd8b; animation-delay: -4.4s; }
.marquee { position: relative; z-index: 2; display: flex; align-items: center; gap: 14px; font-size: 9px; letter-spacing: .24em; color: rgba(246,240,229,.35); }
.marquee i { width: 4px; height: 4px; border-radius: 50%; background: var(--coral); opacity: .8; }
.panel { position: relative; display: grid; place-items: center; padding: 40px; background: var(--paper-2); color: var(--ink); }
.form-card { width: min(390px, 100%); }
.tabs { position: relative; display: inline-flex; padding: 5px; border-radius: 999px; background: rgba(16,24,34,.06); margin-bottom: 34px; }
.tabs button {
  position: relative; z-index: 2; border: 0; background: transparent; padding: 9px 24px; border-radius: 999px;
  font-size: 13px; font-weight: 700; color: var(--muted); cursor: pointer; transition: color .25s;
}
.tabs button.active { color: #fff; }
.tab-ink {
  position: absolute; z-index: 1; top: 5px; bottom: 5px; left: 5px; width: calc(50% - 5px);
  border-radius: 999px; background: var(--ink); transition: transform .34s cubic-bezier(.2,.9,.2,1);
}
.tab-ink.right { transform: translateX(100%); }
.form-title h2 { font-size: 38px; margin: 0 0 8px; }
.form-title p { margin: 0 0 30px; font-size: 13px; }
.submit { width: 100%; margin-top: 26px; padding: 14px 20px; }
.switch { margin: 22px 0 0; font-size: 12px; color: var(--muted); text-align: center; }
.switch button { border: 0; background: transparent; color: var(--coral); font-weight: 700; cursor: pointer; }
.panel-foot { position: absolute; bottom: 24px; font-size: 8px; letter-spacing: .3em; color: rgba(16,24,34,.3); }
@media (max-width: 900px) {
  .auth { grid-template-columns: 1fr; }
  .art { min-height: 460px; padding: 34px 26px; }
  .art-copy h1 { font-size: 46px; }
  .orbit { width: 220px; height: 220px; right: -40px; top: 10%; opacity: .55; }
  .panel { padding: 34px 22px 60px; }
}
@media (max-width: 560px) {
  .art { min-height: 400px; }
  .art-copy h1 { font-size: 38px; }
  .art-copy p { font-size: 13px; }
  .marquee { display: none; }
}
</style>
