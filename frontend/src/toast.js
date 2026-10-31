import { reactive } from 'vue'

export const toasts = reactive([])
let id = 0

export function notify(message, type = 'info') {
  const item = { id: ++id, message, type }
  toasts.push(item)
  setTimeout(() => {
    const idx = toasts.findIndex((t) => t.id === item.id)
    if (idx >= 0) toasts.splice(idx, 1)
  }, 3200)
}
