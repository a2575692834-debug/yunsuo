import { insertResource, insertShare, newId } from '../db.js'
import { getProvider } from '../providers/index.js'
import { queue } from '../queue.js'
import { parseOne } from '../utils/parse.js'

function cloudName(account) {
  return account?.provider === 'baidu' ? '百度网盘' : '夸克网盘'
}

export function validateCloudSyncPair(sourceAccount, destinationAccount) {
  if (!sourceAccount) throw Object.assign(new Error('源网盘账号不存在'), { status: 404 })
  if (!destinationAccount) throw Object.assign(new Error('目标网盘账号不存在'), { status: 404 })
  if (!['baidu', 'quark'].includes(sourceAccount.provider)) {
    throw Object.assign(new Error('源网盘目前只支持百度网盘和夸克网盘'), { status: 400 })
  }
  if (!['baidu', 'quark'].includes(destinationAccount.provider)) {
    throw Object.assign(new Error('目标网盘目前只支持百度网盘和夸克网盘'), { status: 400 })
  }
  if (sourceAccount.id === destinationAccount.id) {
    throw Object.assign(new Error('源账号和目标账号不能相同'), { status: 400 })
  }
  if (sourceAccount.provider === destinationAccount.provider) {
    throw Object.assign(new Error('跨盘同步需要选择不同网盘类型的账号'), { status: 400 })
  }
  if (!sourceAccount.cookie) {
    throw Object.assign(new Error(`${cloudName(sourceAccount)}源账号还没有登录`), { status: 400 })
  }
  if (!destinationAccount.cookie) {
    throw Object.assign(new Error(`${cloudName(destinationAccount)}目标账号还没有登录`), { status: 400 })
  }
}

async function runDirection({
  api,
  userId,
  sourceAccount,
  destinationAccount,
  sourcePath,
  destinationPath,
  title,
  exactTarget = false,
  persistShare = true,
  progressStart = 8,
  progressEnd = 88,
  deps = {}
}) {
  const providerFor = deps.getProvider || getProvider
  const saveShare = deps.insertShare || insertShare
  const saveResource = deps.insertResource || insertResource
  const idFactory = deps.newId || newId
  const sourceProvider = providerFor(sourceAccount.provider)
  const destinationProvider = providerFor(destinationAccount.provider)
  const route = `${sourceProvider.name} → ${destinationProvider.name}`

  await api.log(`${route}：准备同步「${title}」`)
  await api.progress(progressStart)

  const shared = await sourceProvider.share(sourceAccount, [sourcePath], {
    unlimited: true,
    expires: 0,
    passcode: '',
    title
  })
  if (!shared?.url) throw new Error('源网盘没有返回临时分享链接')

  if (persistShare) {
    await saveShare({
      id: idFactory('share'),
      userId,
      accountId: sourceAccount.id,
      provider: sourceAccount.provider,
      taskId: api.taskId,
      title: `跨盘同步 · ${title}`.slice(0, 180),
      url: shared.url,
      passcode: shared.passcode || '',
      expires: shared.expires ?? 0,
      createdAt: Date.now()
    })
  }
  await api.log(`${route}：临时分享已创建，开始写入目标网盘`)
  await api.progress(progressStart + Math.round((progressEnd - progressStart) * 0.35))

  const link = parseOne(shared.url)
  if (!link) throw new Error('临时分享链接无法识别')
  link.passcode = shared.passcode || ''

  const saved = await destinationProvider.transfer(
    destinationAccount,
    {
      ...link,
      syncMode: true,
      ...(exactTarget ? { exactTargetPath: destinationPath } : {})
    },
    link.passcode,
    destinationPath
  )

  if (saved?.skipped) {
    await api.log(`${route}：目标目录已包含全部同名文件，本次没有重复写入`)
  } else {
    const savedPath = saved?.savedPaths?.[0] || destinationPath
    await api.log(`${route}：已写入目标网盘 → ${savedPath}`)
    await saveResource({
      id: idFactory('res'),
      userId,
      accountId: destinationAccount.id,
      provider: destinationAccount.provider,
      title,
      sourceUrl: shared.url,
      sourceCode: shared.passcode || '',
      savedPath,
      taskId: api.taskId,
      createdAt: Date.now()
    })
  }
  await api.progress(progressEnd)
  return { shared, saved, route }
}

export async function enqueueCloudSync({
  userId,
  sourceAccount,
  destinationAccount,
  sourcePath,
  sourceName,
  destinationPath,
  deps = {}
}) {
  validateCloudSyncPair(sourceAccount, destinationAccount)

  const providerFor = deps.getProvider || getProvider
  const taskQueue = deps.queue || queue
  const sourceProvider = providerFor(sourceAccount.provider)
  const destinationProvider = providerFor(destinationAccount.provider)
  const title = String(sourceName || sourcePath.split('/').pop() || '跨盘同步').slice(0, 180)

  const task = await taskQueue.add(
    userId,
    'cloud-sync',
    `${sourceProvider.name} → ${destinationProvider.name} · ${title}`,
    {
      sourceAccountId: sourceAccount.id,
      sourceProvider: sourceAccount.provider,
      sourcePath,
      destinationAccountId: destinationAccount.id,
      destinationProvider: destinationAccount.provider,
      destinationPath,
      sourceName: title,
      syncMode: 'incremental'
    },
    async (api) => {
      const result = await runDirection({
        api,
        userId,
        sourceAccount,
        destinationAccount,
        sourcePath,
        destinationPath,
        title,
        deps
      })
      if (result.saved?.skipped) {
        await api.setDetail?.({ skipped: true, addedCount: 0 })
      }
      await api.progress(100)
    }
  )

  return {
    taskId: task.id,
    title,
    sourceProvider: sourceAccount.provider,
    destinationProvider: destinationAccount.provider
  }
}

export async function enqueueCloudSyncPair({
  userId,
  scheduleId = '',
  baiduAccount,
  quarkAccount,
  baiduPath,
  quarkPath,
  deps = {}
}) {
  validateCloudSyncPair(baiduAccount, quarkAccount)

  const providerFor = deps.getProvider || getProvider
  const taskQueue = deps.queue || queue
  const baiduProvider = providerFor('baidu')
  const quarkProvider = providerFor('quark')
  const baiduName = String(baiduPath.split('/').filter(Boolean).pop() || '百度目录').slice(0, 80)
  const quarkName = String(quarkPath.split('/').filter(Boolean).pop() || '夸克目录').slice(0, 80)
  const title = `24h 双向同步 · ${baiduName} ⇄ ${quarkName}`.slice(0, 180)

  const task = await taskQueue.add(
    userId,
    'cloud-sync',
    title,
    {
      mode: 'bidirectional',
      scheduleId,
      baiduAccountId: baiduAccount.id,
      baiduPath,
      quarkAccountId: quarkAccount.id,
      quarkPath,
      syncMode: 'incremental-bidirectional'
    },
    async (api) => {
      const results = []
      const errors = []
      const directions = [
        {
          sourceAccount: baiduAccount,
          destinationAccount: quarkAccount,
          sourcePath: baiduPath,
          destinationPath: quarkPath,
          title: baiduName,
          start: 6,
          end: 47
        },
        {
          sourceAccount: quarkAccount,
          destinationAccount: baiduAccount,
          sourcePath: quarkPath,
          destinationPath: baiduPath,
          title: quarkName,
          start: 52,
          end: 94
        }
      ]

      for (const direction of directions) {
        try {
          const result = await runDirection({
            api,
            userId,
            sourceAccount: direction.sourceAccount,
            destinationAccount: direction.destinationAccount,
            sourcePath: direction.sourcePath,
            destinationPath: direction.destinationPath,
            title: direction.title,
            exactTarget: true,
            persistShare: false,
            progressStart: direction.start,
            progressEnd: direction.end,
            deps
          })
          results.push({
            route: result.route,
            skipped: result.saved?.skipped === true
          })
        } catch (err) {
          const message = err?.message || String(err)
          errors.push(`${direction.title}: ${message}`)
          await api.log(`同步失败：${message}`)
        }
      }

      await api.setDetail?.({
        mode: 'bidirectional',
        directions: results,
        skipped: results.length === 2 && results.every((item) => item.skipped)
      })
      if (errors.length) {
        throw new Error(`双向同步未完全成功：${errors.join('；')}`)
      }
      await api.progress(100)
    }
  )

  return {
    taskId: task.id,
    title,
    baiduProvider: baiduProvider.name,
    quarkProvider: quarkProvider.name
  }
}
