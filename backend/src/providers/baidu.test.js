import assert from 'node:assert/strict'
import test from 'node:test'
import { BaiduProvider } from './baidu.js'

const account = {
  id: 'acc_test',
  provider: 'baidu',
  cookie: 'BDUSS=test-session; BDSTOKEN=test-token'
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function mockShareFetch({ passcode = 'A1B2', share = {} } = {}) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    if (target.includes('/api/list?')) {
      calls.push({ kind: 'list', url: target })
      return json({
        errno: 0,
        list: [{ server_filename: '测试文件.zip', fs_id: 123456, isdir: 0, size: 1024 }]
      })
    }
    if (target.includes('/share/set?')) {
      calls.push({
        kind: 'share',
        url: target,
        body: new URLSearchParams(String(init.body || ''))
      })
      return json({
        errno: 0,
        shorturl: 'https://pan.baidu.com/s/test-share',
        link: 'https://pan.baidu.com/s/test-share',
        shareid: 987654,
        ...share
      })
    }
    return json({ errno: 404, show_msg: 'unexpected endpoint' }, 404)
  }
  return { calls, passcode }
}

test('baidu share sends required query, form fields and returns share metadata', async () => {
  const originalFetch = globalThis.fetch
  const { calls } = mockShareFetch()

  try {
    const provider = new BaiduProvider()
    const result = await provider.share(account, ['/测试文件.zip'], {
      expires: 7,
      passcode: 'A1B2'
    })

    const shareCall = calls.find((call) => call.kind === 'share')
    assert.ok(shareCall)
    const url = new URL(shareCall.url)
    assert.equal(url.origin + url.pathname, 'https://pan.baidu.com/share/set')
    assert.equal(url.searchParams.get('channel'), 'chunlei')
    assert.equal(url.searchParams.get('clienttype'), '0')
    assert.equal(url.searchParams.get('web'), '1')
    assert.equal(url.searchParams.get('app_id'), '250528')
    assert.equal(url.searchParams.get('bdstoken'), 'test-token')
    assert.equal(shareCall.body.get('fid_list'), '[123456]')
    assert.equal(shareCall.body.get('period'), '7')
    assert.equal(shareCall.body.get('pwd'), 'A1B2')
    assert.equal(shareCall.body.get('schannel'), '4')
    assert.equal(shareCall.body.get('channel_list'), '[]')
    assert.deepEqual(result, {
      shareId: 987654,
      url: 'https://pan.baidu.com/s/test-share',
      passcode: 'A1B2',
      expires: 7
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('baidu share generates a four-character passcode when none is provided', async () => {
  const originalFetch = globalThis.fetch
  const { calls } = mockShareFetch()

  try {
    const provider = new BaiduProvider()
    const result = await provider.share(account, ['/测试文件.zip'], {
      expires: 7,
      passcode: ''
    })

    const shareCall = calls.find((call) => call.kind === 'share')
    const sentPasscode = shareCall.body.get('pwd')
    assert.match(sentPasscode, /^[A-Z0-9]{4}$/)
    assert.equal(result.passcode, sentPasscode)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('baidu permanent share sends period zero', async () => {
  const originalFetch = globalThis.fetch
  const { calls } = mockShareFetch()

  try {
    const provider = new BaiduProvider()
    const result = await provider.share(account, ['/测试文件.zip'], {
      unlimited: true,
      expires: 0,
      passcode: 'Z9Y8'
    })

    const shareCall = calls.find((call) => call.kind === 'share')
    assert.equal(shareCall.body.get('period'), '0')
    assert.equal(result.expires, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('baidu share surfaces the API error message', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/list?')) {
      return json({
        errno: 0,
        list: [{ server_filename: '测试文件.zip', fs_id: 123456, isdir: 0, size: 1024 }]
      })
    }
    return json({ errno: 2, show_msg: 'pwd length param error' })
  }

  try {
    const provider = new BaiduProvider()
    await assert.rejects(
      provider.share(account, ['/测试文件.zip'], { expires: 7, passcode: 'A1B2' }),
      /pwd length param error/
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('baidu share rejects a successful response without a share URL', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/list?')) {
      return json({
        errno: 0,
        list: [{ server_filename: '测试文件.zip', fs_id: 123456, isdir: 0, size: 1024 }]
      })
    }
    return json({ errno: 0, shareid: 987654 })
  }

  try {
    const provider = new BaiduProvider()
    await assert.rejects(
      provider.share(account, ['/测试文件.zip'], { expires: 7, passcode: 'A1B2' }),
      /没有返回分享链接/
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('baidu transfer normalizes short links and preserves the verified share session', async () => {
  const originalFetch = globalThis.fetch
  let initAttempts = 0
  let initUrl = ''
  let verifyCall
  let listCookie = ''
  let transferCall
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    if (target.includes('/share/init?')) {
      initAttempts++
      initUrl = target
      if (initAttempts === 1) {
        throw new TypeError('terminated', { cause: { code: 'ECONNRESET' } })
      }
      return new Response(
        "<script>yunData = {shareid:'123', share_uk:'456', filename:'资源.zip'};</script>"
      )
    }
    if (target.includes('/share/verify')) {
      verifyCall = { url: target, body: new URLSearchParams(String(init.body || '')) }
      return new Response(JSON.stringify({ errno: 0, randsk: 'test-randsk' }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'BDCLND=test-randsk; Path=/'
        }
      })
    }
    if (target.includes('/share/list?')) {
      listCookie = String(init.headers?.Cookie || '')
      return json({
        errno: 0,
        list: [{ server_filename: '资源.zip', fs_id: 789, isdir: 0, size: 1024 }]
      })
    }
    if (target.includes('/api/create?')) {
      return json({ errno: 0, fs_id: 222 })
    }
    if (target.includes('/api/list?')) {
      return json({ errno: 0, list: [] })
    }
    if (target.includes('/share/transfer?')) {
      transferCall = { url: target, body: new URLSearchParams(String(init.body || '')) }
      return json({ errno: 0 })
    }
    return json({ errno: 404 }, 404)
  }

  try {
    const provider = new BaiduProvider()
    const result = await provider.transfer(
      account,
      { key: '1test-share', provider: 'baidu' },
      '6868',
      '/'
    )
    assert.equal(initAttempts, 2)
    assert.match(initUrl, /[?&]surl=test-share(?:&|$)/)
    const verifyUrl = new URL(verifyCall.url)
    assert.equal(verifyUrl.searchParams.get('shareid'), '123')
    assert.equal(verifyUrl.searchParams.get('uk'), '456')
    assert.equal(verifyUrl.searchParams.get('clienttype'), '1')
    assert.equal(verifyCall.body.get('pwd'), '6868')
    assert.equal(verifyCall.body.get('vcode'), 'null')
    assert.equal(verifyCall.body.get('bdstoken'), 'test-token')
    assert.match(listCookie, /BDCLND=test-randsk/)
    assert.equal(transferCall.body.get('fsidlist'), '[789]')
    assert.equal(transferCall.body.get('path'), '/资源.zip')
    assert.deepEqual(result, {
      sourceName: '资源.zip',
      savedPaths: ['/资源.zip']
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('baidu incremental sync only transfers files missing from the destination', async () => {
  const originalFetch = globalThis.fetch
  let transferCall
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/share/transfer?')) {
      transferCall = { url: String(url), body: new URLSearchParams(String(init.body || '')) }
      return json({ errno: 0 })
    }
    return json({ errno: 404 }, 404)
  }

  try {
    const provider = new BaiduProvider()
    provider.shareContext = async () => ({
      surl: 'test-share',
      shareid: '123',
      uk: '456',
      pageToken: 'test-token',
      activeAccount: account,
      files: [
        { server_filename: '已存在.mp4', fs_id: 111, isdir: 0, size: 1024 },
        { server_filename: '新增.mp4', fs_id: 222, isdir: 0, size: 2048 }
      ],
      sourceName: '资源合集',
      referer: 'https://pan.baidu.com/s/test-share'
    })
    provider.transferFolder = async () => '/资源合集'
    provider.list = async () => [{ name: '已存在.mp4', type: 'file', size: 1024 }]

    const result = await provider.transfer(
      account,
      { key: '1test-share', provider: 'baidu', syncMode: true },
      '6868',
      '/'
    )

    assert.equal(transferCall.body.get('fsidlist'), '[222]')
    assert.equal(transferCall.body.get('path'), '/资源合集')
    assert.equal(transferCall.body.get('ondup'), 'newcopy')
    assert.deepEqual(result.savedPaths, ['/资源合集'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('baidu exact target sync writes missing files into the selected folder', async () => {
  const originalFetch = globalThis.fetch
  let transferCall
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/share/transfer?')) {
      transferCall = { body: new URLSearchParams(String(init.body || '')) }
      return json({ errno: 0 })
    }
    return json({ errno: 404 }, 404)
  }

  try {
    const provider = new BaiduProvider()
    provider.shareContext = async () => ({
      surl: 'test-share',
      shareid: '123',
      uk: '456',
      pageToken: 'test-token',
      activeAccount: account,
      files: [
        { server_filename: '已存在.mp4', fs_id: 111, isdir: 0, size: 1024 },
        { server_filename: '新增.mp4', fs_id: 222, isdir: 0, size: 2048 }
      ],
      sourceName: '资源合集',
      referer: 'https://pan.baidu.com/s/test-share'
    })
    provider.ensureFolder = async (_account, path) => path
    provider.transferFolder = async () => {
      throw new Error('exact target sync must not create a wrapper folder')
    }
    provider.list = async () => [{ name: '已存在.mp4', type: 'file', size: 1024 }]

    const result = await provider.transfer(
      account,
      {
        key: '1test-share',
        provider: 'baidu',
        syncMode: true,
        exactTargetPath: '/固定同步目录'
      },
      '6868',
      '/固定同步目录'
    )

    assert.equal(transferCall.body.get('fsidlist'), '[222]')
    assert.equal(transferCall.body.get('path'), '/固定同步目录')
    assert.deepEqual(result.savedPaths, ['/固定同步目录'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('baidu serializes concurrent share verification per account', async () => {
  const originalFetch = globalThis.fetch
  let activeInit = 0
  let maxActiveInit = 0

  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/share/init?')) {
      const surl = new URL(target).searchParams.get('surl')
      activeInit++
      maxActiveInit = Math.max(maxActiveInit, activeInit)
      await new Promise((resolve) => setTimeout(resolve, 30))
      activeInit--
      return new Response(
        `<script>yunData = {shareid:'${surl}', share_uk:'456', filename:'资源-${surl}.zip'};</script>`
      )
    }
    if (target.includes('/share/verify?')) {
      return json({ errno: 0, randsk: 'test-randsk' })
    }
    if (target.includes('/share/list?')) {
      return json({
        errno: 0,
        list: [{ server_filename: '资源.zip', fs_id: 789, isdir: 0, size: 1024 }]
      })
    }
    return json({ errno: 404 }, 404)
  }

  try {
    const provider = new BaiduProvider({
      shareMinIntervalMs: 0,
      shareVerifyRetryDelayMs: 0
    })
    await Promise.all([
      provider.shareNames(account, { key: 'share-a', url: 'https://pan.baidu.com/s/share-a' }, 'A1B2'),
      provider.shareNames(account, { key: 'share-b', url: 'https://pan.baidu.com/s/share-b' }, 'C3D4')
    ])
    assert.equal(maxActiveInit, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('baidu retries a transient share passcode verification failure', async () => {
  const originalFetch = globalThis.fetch
  let verifyAttempts = 0

  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/share/init?')) {
      return new Response(
        "<script>yunData = {shareid:'123', share_uk:'456', filename:'资源.zip'};</script>"
      )
    }
    if (target.includes('/share/verify?')) {
      verifyAttempts++
      return json({
        errno: verifyAttempts === 1 ? -12 : 0,
        ...(verifyAttempts === 1 ? {} : { randsk: 'test-randsk' })
      })
    }
    if (target.includes('/share/list?')) {
      return json({
        errno: 0,
        list: [{ server_filename: '资源.zip', fs_id: 789, isdir: 0, size: 1024 }]
      })
    }
    return json({ errno: 404 }, 404)
  }

  try {
    const provider = new BaiduProvider({
      shareMinIntervalMs: 0,
      shareVerifyRetryDelayMs: 0
    })
    const result = await provider.shareNames(
      account,
      { key: 'share-a', url: 'https://pan.baidu.com/s/share-a' },
      'A1B2'
    )
    assert.equal(verifyAttempts, 2)
    assert.equal(result.title, '资源.zip')
  } finally {
    globalThis.fetch = originalFetch
  }
})
