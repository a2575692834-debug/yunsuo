import { QuarkProvider } from './quark.js'
import { BaiduProvider } from './baidu.js'
import { XunleiProvider } from './xunlei.js'

const registry = new Map([
  ['baidu', new BaiduProvider()],
  ['quark', new QuarkProvider()],
  ['xunlei', new XunleiProvider()]
])

export function getProvider(id) {
  const provider = registry.get(id)
  if (!provider) throw Object.assign(new Error('未知网盘: ' + id), { status: 400 })
  return provider
}

export function listProviders() {
  return [...registry.values()].map((p) => ({
    id: p.id,
    name: p.name,
    qr: p.canQr,
    transfer: p.canTransfer,
    share: p.canShare,
    files: p.canFiles,
    search: p.canSearch,
    operations: p.operations()
  }))
}

export function providerName(id) {
  return registry.get(id)?.name || id
}
