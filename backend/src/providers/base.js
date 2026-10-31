export class Provider {
  constructor({ id, name, qr = false, transfer = false, share = false, files = false, copy = true, search = false }) {
    this.id = id
    this.name = name
    // 能力标记不能与方法名同名,否则会覆盖原型上的 transfer/share 方法。
    this.canQr = qr
    this.canTransfer = transfer
    this.canShare = share
    this.canFiles = files
    this.canCopy = copy
    this.canSearch = search
  }

  fail(message) {
    throw Object.assign(new Error(message), { status: 400 })
  }

  needCookie(account) {
    if (!account?.cookie) this.fail(`${this.name} 账号还没有登录 Cookie`)
  }

  notReady(action) {
    this.fail(`${this.name} 的「${action}」驱动还在适配中,可先使用演示空间体验完整流程`)
  }

  async qrStart() { this.notReady('扫码登录') }
  async qrPoll() { this.notReady('扫码登录') }
  async usage() { return null }
  async list() { this.notReady('文件列表') }
  async rename() { this.notReady('重命名') }
  async remove() { this.notReady('删除') }
  async copy() { this.notReady('复制') }
  async move() { this.notReady('移动') }
  async mkdir() { this.notReady('新建文件夹') }
  async transfer() { this.notReady('转存') }
  async share() { this.notReady('创建分享') }
  async search() { return [] }

  operations() {
    return {
      rename: true,
      delete: true,
      copy: this.canCopy,
      move: true,
      mkdir: true
    }
  }
}
