import assert from 'node:assert/strict'
import test from 'node:test'
import { QuarkProvider } from './quark.js'

const account = { id: 'acc_test', provider: 'quark', cookie: '__puus=test-session' }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

test('quark share always omits the passcode and sends expiry timestamp', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null })
    if (String(url).includes('/clouddrive/share?')) {
      return json({ code: 0, data: { task_id: 'task_share_1' } })
    }
    if (String(url).includes('/clouddrive/task?')) {
      return json({ code: 0, data: { status: 2, share_id: 'share_1' } })
    }
    if (String(url).includes('/clouddrive/share/password?')) {
      return json({ code: 0, data: { share_url: 'https://pan.quark.cn/s/test' } })
    }
    return json({ code: 404, message: 'unexpected endpoint' })
  }

  try {
    const provider = new QuarkProvider()
    const result = await provider.share(account, ['/测试文件.zip'], {
      fids: ['fid_1'],
      title: '测试文件.zip',
      expires: 7,
      passcode: 'A1B2'
    })

    assert.equal(result.url, 'https://pan.quark.cn/s/test')
    assert.equal(result.shareId, 'share_1')
    assert.equal(result.passcode, '')
    assert.equal(result.expires, 7)
    assert.equal(calls.length, 3)
    assert.match(calls[0].url, /\/1\/clouddrive\/share\?/)
    assert.match(calls[1].url, /\/1\/clouddrive\/task\?/)
    assert.match(calls[2].url, /\/1\/clouddrive\/share\/password\?/)
    assert.equal(calls[0].body.url_type, 1)
    assert.equal(calls[0].body.expired_type, 2)
    assert.equal(calls[0].body.passcode, '')
    assert.ok(calls[0].body.expired_at > Date.now())
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('quark permanent share omits expired_at', async () => {
  const originalFetch = globalThis.fetch
  let createBody = null
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/clouddrive/share?')) {
      createBody = JSON.parse(init.body)
      return json({ code: 0, data: { task_id: 'task_share_2' } })
    }
    if (String(url).includes('/clouddrive/task?')) {
      return json({ code: 0, data: { status: 2, share_id: 'share_2' } })
    }
    return json({ code: 0, data: { share_url: 'https://pan.quark.cn/s/permanent' } })
  }

  try {
    const provider = new QuarkProvider()
    const result = await provider.share(account, ['/永久分享.zip'], {
      fids: ['fid_2'],
      unlimited: true,
      expires: 0
    })

    assert.equal(result.expires, 0)
    assert.equal(createBody.expired_type, 1)
    assert.equal('expired_at' in createBody, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('quark transfer creates folders and saves through the sharepage endpoint', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const requestUrl = String(url)
    calls.push({ url: requestUrl, body: init.body ? JSON.parse(init.body) : null })
    if (requestUrl.includes('/share/sharepage/token?')) {
      return json({ code: 0, data: { stoken: 'stoken_test' } })
    }
    if (requestUrl.includes('/share/sharepage/detail?')) {
      return json({
        code: 0,
        data: {
          list: [{
            share_fid: 'share_fid_1',
            share_fid_token: 'token_1',
            file_name: '原资源名称.zip',
            file: true
          }]
        }
      })
    }
    if (requestUrl.includes('/share/sharepage/save?')) {
      return json({ code: 0, data: { task_id: 'save_task_1' } })
    }
    if (requestUrl.includes('/clouddrive/task?')) {
      return json({
        code: 0,
        data: { status: 2, save_as: { save_as_top_fids: ['saved_fid_1'] } }
      })
    }
    return json({ code: 404, message: 'unexpected endpoint' })
  }

  try {
    const provider = new QuarkProvider()
    provider.transferFolder = async () => ({
      path: '/转存/2026-10-31/原资源名称.zip',
      fid: 'target_fid'
    })
    provider.listByFid = async () => [{
      fid: 'saved_fid_1',
      name: '原资源名称.zip',
      path: '/转存/2026-10-31/原资源名称.zip/原资源名称.zip',
      type: 'file'
    }]

    const result = await provider.transfer(
      account,
      { key: 'pwd_test', provider: 'quark' },
      '',
      '/转存/2026-10-31'
    )

    const saveCall = calls.find((call) => call.url.includes('/share/sharepage/save?'))
    assert.ok(saveCall)
    assert.equal(saveCall.body.fid_list[0], 'share_fid_1')
    assert.equal(saveCall.body.fid_token_list[0], 'token_1')
    assert.equal(saveCall.body.to_pdir_fid, 'target_fid')
    assert.equal(saveCall.body.pwd_id, 'pwd_test')
    assert.equal(saveCall.body.stoken, 'stoken_test')
    assert.equal(result.sourceName, '原资源名称.zip')
    assert.deepEqual(result.savedFids, ['saved_fid_1'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('quark folder creation uses the file endpoint', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  let nextFid = 1
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null })
    return json({ code: 0, data: { fid: `folder_${nextFid++}` } })
  }

  try {
    const provider = new QuarkProvider()
    provider.listByFid = async () => []

    const fid = await provider.ensureFolder(account, '/转存/2026-10-31')

    assert.equal(fid, 'folder_2')
    assert.equal(calls.length, 2)
    for (const call of calls) {
      assert.match(call.url, /\/1\/clouddrive\/file\?/)
      assert.equal(call.body.dir_path, '')
      assert.equal(call.body.dir_init_lock, false)
    }
    assert.equal(calls[0].body.pdir_fid, '0')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('quark folder conflicts reuse a directory that appears after creation', async () => {
  const originalFetch = globalThis.fetch
  let listCalls = 0
  globalThis.fetch = async () => json({
    code: 23008,
    message: 'file is doloading[同名冲突]'
  })

  try {
    const provider = new QuarkProvider()
    provider.listByFid = async () => {
      listCalls++
      return listCalls >= 3
        ? [{ fid: 'existing_folder', type: 'dir', name: '转存' }]
        : []
    }

    const fid = await provider.ensureFolder(account, '/转存')

    assert.equal(fid, 'existing_folder')
    assert.equal(listCalls, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})
