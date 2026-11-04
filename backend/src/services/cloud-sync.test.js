import assert from 'node:assert/strict'
import test from 'node:test'
import { enqueueCloudSync, validateCloudSyncPair } from './cloud-sync.js'

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
