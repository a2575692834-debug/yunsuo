<script setup>
import { toasts } from '../toast.js'
</script>

<template>
  <div class="toast-host">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
        <span class="toast-dot" />
        <span>{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 22px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 300;
  display: grid;
  gap: 8px;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  border-radius: 999px;
  background: rgba(16, 24, 34, .92);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 18px 40px rgba(16, 24, 34, .24);
  backdrop-filter: blur(12px);
}
.toast-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--gold); }
.toast.success .toast-dot { background: #4ade80; }
.toast.error .toast-dot { background: var(--coral); }
.toast-enter-active, .toast-leave-active { transition: all .32s cubic-bezier(.2,.9,.2,1); }
.toast-enter-from { opacity: 0; transform: translateY(-14px) scale(.94); }
.toast-leave-to { opacity: 0; transform: translateY(-8px) scale(.96); }
</style>
