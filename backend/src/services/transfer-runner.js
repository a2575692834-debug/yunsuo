import { insertResource, insertShare, newId } from '../db.js'
import { getProvider } from '../providers/index.js'
import { queue, animatedProgress } from '../queue.js'

function safeTitle(value, fallback) {
  return String(value || fallback || '转存内容').replace(/\s+/g, ' ').trim().slice(0, 180)
}

export async function enqueueTransfer({
  userId,
  account,
  link,
  targetPath,
  autoShare = true,
  unlimited = true,
  expires = 0,
  sharePasscode = '',
  batchId = newId('batch'),
  kind = 'transfer',
  syncMode = false,
  titlePrefix,
  detail = {},
  onSuccess
}) {
  const provider = getProvider(account.provider)
  const prefix = titlePrefix || link.providerName || provider.name
  const task = await queue.add(
    userId,
    kind,
    `${prefix} · ${link.key}`,
    {
      batchId,
      accountId: account.id,
      provider: account.provider,
      url: link.url,
      targetPath,
      autoShare,
      syncMode,
      ...detail
    },
    async (api) => {
      await api.log(`识别为 ${link.providerName || provider.name} 分享`)
      await animatedProgress(api, async () => {
        const saved = await provider.transfer(
          account,
          { ...link, syncMode },
          link.passcode,
          targetPath
        )
        const sourceName = safeTitle(saved.sourceName, link.key)
        await api.rename(`${prefix} · ${sourceName}`)
        await api.log(`转存完成${saved.savedPaths?.length ? ' → ' + saved.savedPaths.join(', ') : ''}`)
        await insertResource({
          id: newId('res'),
          userId,
          accountId: account.id,
          provider: account.provider,
          title: sourceName,
          sourceUrl: link.url,
          sourceCode: link.passcode || '',
          savedPath: saved.savedPaths?.[0] || targetPath,
          taskId: api.taskId,
          batchId,
          createdAt: Date.now()
        })

        let shareRecord = null
        if (autoShare) {
          await api.log('正在创建分享链接…')
          const paths = saved.savedPaths?.length ? saved.savedPaths : [targetPath]
          const shared = await provider.share(account, paths, {
            unlimited,
            expires,
            passcode: sharePasscode,
            title: sourceName,
            fids: saved.savedFids || []
          })
          shareRecord = await insertShare({
            id: newId('share'),
            userId,
            accountId: account.id,
            provider: account.provider,
            batchId,
            taskId: api.taskId,
            title: sourceName,
            url: shared.url,
            passcode: shared.passcode,
            expires: shared.expires ?? expires,
            createdAt: Date.now()
          })
          await api.log(`分享已生成${shareRecord.passcode ? ` · 提取码 ${shareRecord.passcode}` : ''}: ${shareRecord.url}`)
        }

        if (onSuccess) {
          try {
            await onSuccess({ taskId: api.taskId, saved, sourceName, share: shareRecord, batchId })
          } catch (err) {
            await api.log(`同步监控状态失败: ${err.message}`)
          }
        }
      })
    }
  )
  return { task, batchId }
}
