import assert from 'node:assert/strict'
import test from 'node:test'
import {
  enqueueCloudSync,
  enqueueCloudSyncPair,
  validateCloudSyncPair
} from './cloud-sync.js'

function account(id, provider) {
  return { id, provider, cookie: 'session=test', label: provider }
}

test('cloud sync accepts only different Baidu and Quark accounts', () => {
  assert.doesNotThrow(() => validateCloudSyncPair(account('b1', 'baidu'), account('q1', 'quark')))
  assert.doesNotThrow(() => validateCloudSyncPair(account('q1', 'quark'), account('b1', 'baidu')))
  assert.throws(
    () => validateCloudSyncPair(account('b1', 'baidu'), account('b2', 'baidu')),
    /不同网盘类型/
  )
  assert.throws(
    () => validateCloudSyncPair(account('q1', 'quark'), account('q2', 'quark')),
    /不同网盘类型/
  )
})

test('cloud sync creates a temporary share and transfers it incrementally', async () => {
  const calls = []
  const savedShares = []
  const savedResources = []
  const sourceProvider = {
    name: '百度网盘',
    async share(_account, paths, options) {
      calls.push({ type: 'share', paths, options })
      return {
        url: 'https://pan.baidu.com/s/1cloudsync',
        passcode: 'A1B2',
        expires: 0
      }
    }
  }
  const destinationProvider = {
    name: '夸克网盘',
    async transfer(_account, link, passcode, targetPath) {
      calls.push({
        type: 'transfer',
        link,
        passcode,
        targetPath
      })
      return {
        sourceName: '资源目录',
        savedPaths: ['/接收/资源目录'],
        skipped: false
      }
    }
  }
  const taskQueue = {
    async add(userId, kind, title, detail, worker) {
      assert.equal(kind, 'cloud-sync')
      assert.equal(userId, '7')
      const task = { id: 'task_cloudsync', userId, kind, title, detail }
      const api = {
        taskId: task.id,
        logs: [],
        progress: async (value) => { api.progressValue = value },
        log: async (message) => { api.logs.push(message) },
        setDetail: async (patch) => { task.detail = { ...task.detail, ...patch } }
      }
      await worker(api)
      task.api = api
      return task
    }
  }

  const result = await enqueueCloudSync({
    userId: '7',
    sourceAccount: account('b1', 'baidu'),
    destinationAccount: account('q1', 'quark'),
    sourcePath: '/资源目录',
    sourceName: '资源目录',
    destinationPath: '/接收',
    deps: {
      getProvider: (id) => id === 'baidu' ? sourceProvider : destinationProvider,
      queue: taskQueue,
      insertShare: async (record) => { savedShares.push(record) },
      insertResource: async (record) => { savedResources.push(record) },
      newId: (prefix) => `${prefix}_test`
    }
  })

  assert.equal(result.taskId, 'task_cloudsync')
  const shareCall = calls.find((call) => call.type === 'share')
  const transferCall = calls.find((call) => call.type === 'transfer')
  assert.deepEqual(shareCall.paths, ['/资源目录'])
  assert.equal(shareCall.options.unlimited, true)
  assert.equal(transferCall.link.syncMode, true)
  assert.equal(transferCall.link.provider, 'baidu')
  assert.equal(transferCall.passcode, 'A1B2')
  assert.equal(transferCall.targetPath, '/接收')
  assert.equal(savedShares.length, 1)
  assert.equal(savedResources.length, 1)
  assert.equal(savedResources[0].provider, 'quark')
})

test('cloud sync pair transfers both directions into the remembered folders', async () => {
  const calls = []
  const providers = {
    baidu: {
      name: '百度网盘',
      async share(_account, paths, options) {
        calls.push({ type: 'baidu-share', paths, options })
        return {
          url: 'https://pan.baidu.com/s/1pair-share',
          passcode: 'A1B2',
          expires: 0
        }
      },
      async transfer(_account, link, passcode, targetPath) {
        calls.push({ type: 'baidu-transfer', link, passcode, targetPath })
        return { skipped: true, savedPaths: [targetPath] }
      }
    },
    quark: {
      name: '夸克网盘',
      async share(_account, paths, options) {
        calls.push({ type: 'quark-share', paths, options })
        return {
          url: 'https://pan.quark.cn/s/pair-share',
          passcode: '',
          expires: 0
        }
      },
      async transfer(_account, link, passcode, targetPath) {
        calls.push({ type: 'quark-transfer', link, passcode, targetPath })
        return { skipped: true, savedPaths: [targetPath] }
      }
    }
  }
  const taskQueue = {
    async add(userId, kind, title, detail, worker) {
      assert.equal(userId, '7')
      assert.equal(kind, 'cloud-sync')
      assert.equal(detail.mode, 'bidirectional')
      const task = { id: 'task_pair', userId, kind, title, detail }
      const api = {
        taskId: task.id,
        progress: async (value) => { api.progressValue = value },
        log: async (message) => { api.logs.push(message) },
        setDetail: async (patch) => { task.detail = { ...task.detail, ...patch } },
        logs: []
      }
      await worker(api)
      task.api = api
      return task
    }
  }

  const result = await enqueueCloudSyncPair({
    userId: '7',
    scheduleId: 'sync_1',
    baiduAccount: account('b1', 'baidu'),
    quarkAccount: account('q1', 'quark'),
    baiduPath: '/百度同步',
    quarkPath: '/夸克同步',
    deps: {
      getProvider: (id) => providers[id],
      queue: taskQueue,
      insertShare: async () => {
        throw new Error('scheduled sync should not pollute the share library')
      },
      insertResource: async () => {},
      newId: (prefix) => `${prefix}_test`
    }
  })

  assert.equal(result.taskId, 'task_pair')
  const toQuark = calls.find((call) => call.type === 'quark-transfer')
  const toBaidu = calls.find((call) => call.type === 'baidu-transfer')
  assert.equal(toQuark.link.exactTargetPath, '/夸克同步')
  assert.equal(toQuark.targetPath, '/夸克同步')
  assert.equal(toBaidu.link.exactTargetPath, '/百度同步')
  assert.equal(toBaidu.targetPath, '/百度同步')
  assert.equal(calls.filter((call) => call.type.endsWith('-share')).length, 2)
})
