import { Provider } from './base.js'
import { newId, getDemoTree, saveDemoTree } from '../db.js'
import { shareSignature } from './fingerprint.js'

const MB = 1024 * 1024

function seed() {
  const dir = (name, children = []) => ({ type: 'dir', name, children })
  const file = (name, size) => ({ type: 'file', name, size, mtime: Date.now() - Math.random() * 60 * 86400e3 })
  return dir('', [
    dir('灵感收藏', [
      file('城市漫游指南.pdf', 18 * MB),
      file('配色灵感板.png', 6 * MB)
    ]),
    dir('学习资料', [
      dir('设计系统', [
        file('组件规范 v2.pdf', 42 * MB),
        file('动效清单.md', 120 * 1024)
      ]),
      file('字体授权说明.txt', 64 * 1024)
    ]),
    dir('影音', [
      file('片头参考.mp4', 320 * MB),
      file('氛围音乐.flac', 58 * MB)
    ])
  ])
}

const parts = (p) => String(p || '/').split('/').filter(Boolean)

function nodeAt(root, path) {
  let node = root
  for (const part of parts(path)) {
    if (!node || node.type !== 'dir') return null
    node = node.children.find((c) => c.name === part)
  }
  return node
}

function ensureDir(root, path) {
  let node = root
  for (const part of parts(path)) {
    let next = node.children.find((c) => c.name === part && c.type === 'dir')
    if (!next) {
      next = { type: 'dir', name: part, children: [] }
      node.children.push(next)
    }
    node = next
  }
  return node
}

function parentInfo(root, path) {
  const names = parts(path)
  if (!names.length) return null
  const parent = nodeAt(root, '/' + names.slice(0, -1).join('/'))
  if (!parent || parent.type !== 'dir') return null
  return {
    parent,
    name: names[names.length - 1],
    node: parent.children.find((child) => child.name === names[names.length - 1])
  }
}

function cloneNode(node) {
  return {
    type: node.type,
    name: node.name,
    ...(node.type === 'file' ? { size: node.size || 0, mtime: Date.now() } : {}),
    ...(node.type === 'dir' ? { children: (node.children || []).map(cloneNode) } : {})
  }
}

function flatten(node, base = '/', out = []) {
  for (const child of node.children || []) {
    const path = (base === '/' ? '' : base) + '/' + child.name
    out.push({ name: child.name, path, type: child.type, size: child.size || 0, mtime: child.mtime || Date.now() })
    if (child.type === 'dir') flatten(child, path, out)
  }
  return out
}

export class DemoProvider extends Provider {
  constructor() {
    super({ id: 'demo', name: '演示空间', qr: true, transfer: true, share: true, files: true, search: true })
    this.qrPolls = new Map()
  }

  async tree(account) {
    let tree = await getDemoTree(account.id)
    if (!tree) {
      tree = seed()
      await saveDemoTree(account.id, tree)
    }
    return tree
  }

  async list(account, path = '/') {
    const node = nodeAt(await this.tree(account), path)
    if (!node || node.type !== 'dir') this.fail('目录不存在')
    return node.children.map((c) => ({
      name: c.name,
      path: (path === '/' ? '' : path) + '/' + c.name,
      type: c.type,
      size: c.size || 0,
      mtime: c.mtime || Date.now()
    }))
  }

  async rename(account, path, newName) {
    const tree = await this.tree(account)
    const info = parentInfo(tree, path)
    if (!info?.node) this.fail('要重命名的文件不存在')
    if (info.parent.children.some((child) => child !== info.node && child.name === newName)) {
      this.fail('同名文件或文件夹已存在')
    }
    info.node.name = newName
    await saveDemoTree(account.id, tree)
  }

  async remove(account, paths) {
    const tree = await this.tree(account)
    for (const path of paths) {
      const info = parentInfo(tree, path)
      if (!info?.node) this.fail(`文件不存在: ${path}`)
      info.parent.children = info.parent.children.filter((child) => child !== info.node)
    }
    await saveDemoTree(account.id, tree)
  }

  async copy(account, paths, destination) {
    const tree = await this.tree(account)
    const target = nodeAt(tree, destination)
    if (!target || target.type !== 'dir') this.fail('目标目录不存在')
    for (const path of paths) {
      const info = parentInfo(tree, path)
      if (!info?.node) this.fail(`文件不存在: ${path}`)
      if (target.children.some((child) => child.name === info.node.name)) {
        this.fail(`目标目录中已存在同名项目: ${info.node.name}`)
      }
      target.children.push(cloneNode(info.node))
    }
    await saveDemoTree(account.id, tree)
  }

  async move(account, paths, destination) {
    const tree = await this.tree(account)
    const target = nodeAt(tree, destination)
    if (!target || target.type !== 'dir') this.fail('目标目录不存在')
    const moving = []
    for (const path of paths) {
      const info = parentInfo(tree, path)
      if (!info?.node) this.fail(`文件不存在: ${path}`)
      if (target.children.some((child) => child.name === info.node.name)) {
        this.fail(`目标目录中已存在同名项目: ${info.node.name}`)
      }
      moving.push(info)
    }
    for (const info of moving) {
      info.parent.children = info.parent.children.filter((child) => child !== info.node)
      target.children.push(info.node)
    }
    await saveDemoTree(account.id, tree)
  }

  async mkdir(account, parent, name) {
    const tree = await this.tree(account)
    const dir = nodeAt(tree, parent)
    if (!dir || dir.type !== 'dir') this.fail('上级目录不存在')
    if (dir.children.some((child) => child.name === name)) this.fail('同名文件或文件夹已存在')
    dir.children.push({ type: 'dir', name, children: [] })
    await saveDemoTree(account.id, tree)
  }

  async usage(account) {
    const all = flatten(await this.tree(account))
    const used = all.filter((x) => x.type === 'file').reduce((sum, x) => sum + x.size, 0)
    return { used, total: 1024 * 1024 * MB }
  }

  async transfer(account, link, passcode, targetPath = '/') {
    const tree = await this.tree(account)
    const parent = ensureDir(tree, targetPath)
    const name = (link.key || '转存内容').slice(0, 24)
    const item = {
      type: 'dir',
      name,
      children: [
        { type: 'file', name: `${name}_高清版.mp4`, size: 860 * MB, mtime: Date.now() },
        { type: 'file', name: `${name}_说明.pdf`, size: 3 * MB, mtime: Date.now() }
      ]
    }
    const existing = link.syncMode && parent.children.find((child) => child.name === name)
    if (existing && existing.type !== 'dir') {
      this.fail(`无法同步到固定目录: ${targetPath}/${name} 已被同名文件占用`)
    }
    if (existing) {
      existing.children = item.children
    } else {
      parent.children.push(item)
    }
    await saveDemoTree(account.id, tree)
    return {
      sourceName: name,
      savedPaths: [(targetPath === '/' ? '' : targetPath) + '/' + name]
    }
  }

  async inspectShare(account, link) {
    const name = (link.key || '演示资源').slice(0, 24)
    const items = [
      { name: `${name}_高清版.mp4`, path: `/${name}/${name}_高清版.mp4`, type: 'file', size: 860 * MB },
      { name: `${name}_说明.pdf`, path: `/${name}/${name}_说明.pdf`, type: 'file', size: 3 * MB }
    ]
    return {
      title: name,
      signature: shareSignature(name, items),
      items
    }
  }

  async share(account, paths, opts = {}) {
    const passcode = opts.passcode || ''
    return {
      url: `https://yun.demo/s/${newId('s')}`,
      passcode,
      expires: opts.unlimited || Number(opts.expires) === 0 ? 0 : Number(opts.expires || 7)
    }
  }

  async search(account, keyword, options = {}) {
    const kw = String(keyword).toLowerCase()
    return flatten(await this.tree(account))
      .filter((x) => x.name.toLowerCase().includes(kw))
      .slice(0, Math.max(1, Math.min(100, Number(options.limit || 50))))
      .map((item) => ({
        ...item,
        parentPath: item.path.split('/').slice(0, -1).join('/') || '/',
        id: item.path
      }))
  }

  async qrStart() {
    const token = newId('qr')
    this.qrPolls.set(token, 0)
    return { token, qrText: 'https://yun.demo/qr/' + token, qrImage: '' }
  }

  async qrPoll(token) {
    const count = (this.qrPolls.get(token) || 0) + 1
    this.qrPolls.set(token, count)
    if (count >= 4) {
      this.qrPolls.delete(token)
      return { status: 'confirmed', cookie: 'demo_session=' + token, label: '演示空间' }
    }
    return { status: 'pending' }
  }
}
