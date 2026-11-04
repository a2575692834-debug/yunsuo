import { strFromU8, unzipSync } from 'fflate'
import { listAccounts } from '../db.js'
import { getProvider } from '../providers/index.js'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024
const MAX_SHEETS = 20
const MAX_CELLS = 100_000
const MAX_LINKS = 5_000
const DELIST_SCAN_DEPTH = 3
const DELIST_SCAN_MAX_DIRECTORIES = 600
const DELIST_SCAN_MAX_ITEMS = 20_000
const DELIST_SEARCH_LIMIT = 100

const PROVIDERS = {
  baidu: {
    name: '百度网盘',
    hosts: new Set(['pan.baidu.com', 'yun.baidu.com'])
  },
  quark: {
    name: '夸克网盘',
    hosts: new Set(['pan.quark.cn'])
  }
}

const TITLE_HEADERS = ['商品标题', '资源名称', '文件名称', '文件名', '标题']

const URL_RE = /https?:\/\/[^\s"'<>，。；、）)】\]]+/gi

function badRequest(message) {
  throw Object.assign(new Error(message), { status: 400 })
}

function decodeXml(value) {
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    const lower = entity.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : ''
  })
}

function xmlText(xml) {
  const cleaned = String(xml || '').replace(/<rPh\b[\s\S]*?<\/rPh>/gi, '')
  const texts = [...cleaned.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)]
    .map((match) => decodeXml(match[1]))
  if (texts.length) return texts.join('')
  const value = cleaned.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)
  return value ? decodeXml(value[1]) : ''
}

function readAttr(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return decodeXml(match?.[1] ?? match?.[2] ?? '')
}

function columnIndex(reference) {
  const letters = String(reference || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() || ''
  let index = 0
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64
  return Math.max(0, index - 1)
}

function readSharedStrings(files) {
  const raw = files['xl/sharedStrings.xml']
  if (!raw) return []
  const xml = strFromU8(raw)
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)]
    .map((match) => xmlText(match[1]))
}

function readSheetDefinitions(files) {
  const workbook = files['xl/workbook.xml']
  const relationships = files['xl/_rels/workbook.xml.rels']
  if (!workbook) badRequest('文件不是有效的 XLSX 工作簿')

  const relationshipMap = new Map()
  if (relationships) {
    for (const match of strFromU8(relationships).matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
      const id = readAttr(match[1], 'Id')
      const target = readAttr(match[1], 'Target')
      if (id && target) relationshipMap.set(id, target)
    }
  }

  return [...strFromU8(workbook).matchAll(/<sheet\b([^>]*)\/?>/gi)].map((match, index) => {
    const name = readAttr(match[1], 'name') || `Sheet${index + 1}`
    const relationId = readAttr(match[1], 'r:id')
    let target = relationshipMap.get(relationId) || `worksheets/sheet${index + 1}.xml`
    target = target.replace(/\\/g, '/')
    if (target.startsWith('/')) target = target.slice(1)
    else if (!target.startsWith('xl/')) target = `xl/${target.replace(/^\.\//, '')}`
    return { name, path: target }
  })
}

function readCell(attrs, body, sharedStrings) {
  const type = readAttr(attrs, 't')
  if (type === 'inlineStr') return xmlText(body).trim()
  const value = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1] ?? ''
  if (type === 's') return sharedStrings[Number(value)] || ''
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE'
  return decodeXml(value).trim()
}

function readRows(sheetXml, sharedStrings) {
  const rows = []
  let cells = 0
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const rowNumber = Number(readAttr(rowMatch[1], 'r')) || rows.length + 1
    const values = []
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const index = columnIndex(readAttr(cellMatch[1], 'r'))
      values[index] = readCell(cellMatch[1], cellMatch[2] || '', sharedStrings)
      cells++
      if (cells > MAX_CELLS) badRequest(`表格内容过多，最多支持 ${MAX_CELLS.toLocaleString('zh-CN')} 个单元格`)
    }
    rows.push({ rowNumber, values })
  }
  return rows.sort((a, b) => a.rowNumber - b.rowNumber)
}

export function parseXlsxWorkbook(buffer) {
  const bytes = Buffer.from(buffer || [])
  if (!bytes.length) badRequest('请选择要导入的 XLSX 文件')
  if (bytes.length > MAX_FILE_BYTES) badRequest('XLSX 文件不能超过 12 MB')
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) badRequest('文件不是有效的 XLSX 格式')

  let files
  let expandedBytes = 0
  try {
    files = unzipSync(new Uint8Array(bytes), {
      filter(file) {
        expandedBytes += file.originalSize
        if (expandedBytes > MAX_UNCOMPRESSED_BYTES) {
          badRequest('XLSX 解压后内容过大，无法安全处理')
        }
        return true
      }
    })
  } catch (err) {
    if (err.status === 400) throw err
    badRequest('XLSX 文件已损坏或无法解压')
  }

  const definitions = readSheetDefinitions(files).slice(0, MAX_SHEETS)
  if (!definitions.length) badRequest('XLSX 中没有可读取的工作表')
  const sharedStrings = readSharedStrings(files)
  return definitions.map((sheet) => {
    const raw = files[sheet.path]
    if (!raw) return { name: sheet.name, rows: [] }
    return {
      name: sheet.name,
      rows: readRows(strFromU8(raw), sharedStrings)
    }
  })
}

function cellText(row, index) {
  return index >= 0 ? String(row.values[index] || '').trim() : ''
}

function findHeader(rows) {
  let best = null
  for (let index = 0; index < Math.min(rows.length, 15); index++) {
    const row = rows[index]
    const values = row.values.map((value) => String(value || '').trim())
    const hints = values.filter((value) => TITLE_HEADERS.some((header) => value === header || value.includes(header))).length
    const nonEmpty = values.filter(Boolean).length
    if (!best || hints > best.hints || (hints === best.hints && nonEmpty > best.nonEmpty)) {
      best = { index, hints, nonEmpty }
    }
  }
  if (!best || !best.nonEmpty) return { index: 0, headers: [] }
  return {
    index: best.index,
    headers: rows[best.index].values.map((value) => String(value || '').trim())
  }
}

function titleColumn(headers) {
  for (const name of TITLE_HEADERS) {
    const index = headers.findIndex((header) => header === name)
    if (index >= 0) return index
  }
  return headers.findIndex((header) => TITLE_HEADERS.some((name) => header.includes(name)))
}

function cleanUrl(value) {
  return String(value || '').replace(/[，。；、）)】\].,;:!?]+$/g, '')
}

export function parseShareUrl(value) {
  try {
    const url = new URL(cleanUrl(value))
    const host = url.hostname.toLowerCase()
    const provider = Object.entries(PROVIDERS).find(([, info]) => info.hosts.has(host))?.[0]
    if (!provider) return null
    const key = url.pathname.match(/\/s\/([^/]+)/i)?.[1]
    if (!key) return null
    return {
      provider,
      providerName: PROVIDERS[provider].name,
      key,
      canonical: `${provider}:${key}`
    }
  } catch {
    return null
  }
}

export function extractShareLinks(workbook) {
  const links = new Map()
  let totalRows = 0

  for (const sheet of workbook) {
    if (!sheet.rows.length) continue
    const header = findHeader(sheet.rows)
    const titleIndex = titleColumn(header.headers)
    for (const row of sheet.rows.slice(header.index + 1)) {
      if (!row.values.some(Boolean)) continue
      totalRows++
      const sourceTitle = cellText(row, titleIndex)
      for (let column = 0; column < row.values.length; column++) {
        const text = String(row.values[column] || '')
        for (const raw of text.match(URL_RE) || []) {
          const parsed = parseShareUrl(raw)
          if (!parsed) continue
          const existing = links.get(parsed.canonical)
          if (existing) {
            existing.rows.add(row.rowNumber)
            existing.columns.add(header.headers[column] || `第 ${column + 1} 列`)
            if (!existing.sourceTitle && sourceTitle) existing.sourceTitle = sourceTitle
            existing.occurrences++
            continue
          }
          if (links.size >= MAX_LINKS) badRequest(`表格中的网盘链接过多，最多支持 ${MAX_LINKS} 个`)
          links.set(parsed.canonical, {
            canonical: parsed.canonical,
            provider: parsed.provider,
            providerName: parsed.providerName,
            key: parsed.key,
            url: cleanUrl(raw),
            sourceTitle: sourceTitle || '',
            sheet: sheet.name,
            rows: new Set([row.rowNumber]),
            columns: new Set([header.headers[column] || `第 ${column + 1} 列`]),
            occurrences: 1
          })
        }
      }
    }
  }

  return {
    totalRows,
    sheets: workbook.map((sheet) => sheet.name),
    links: [...links.values()].map((link) => ({
      ...link,
      rows: [...link.rows],
      columns: [...link.columns]
    }))
  }
}

function normalizedTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^【[^】]*】/, '')
    .replace(/[\s\-_—+·,，。.。;；:：()[\]（）【】"'“”‘’]/g, '')
}

function matchMethodForTitle(title, itemName) {
  const normalized = normalizedTitle(title)
  if (!normalized) return ''
  if (normalizedTitle(itemName) === normalized) return 'exact'
  const withoutCopyNumber = String(itemName || '').replace(/\s*\(\d+\)\s*$/, '')
  return normalizedTitle(withoutCopyNumber) === normalized ? 'copy' : ''
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

function groupLinksForDelist(links) {
  const groups = new Map()
  const withoutTitle = []
  for (const link of links) {
    const titleKey = normalizedTitle(link.sourceTitle)
    if (!titleKey) {
      withoutTitle.push(link)
      continue
    }
    const key = `${link.provider}\0${titleKey}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        provider: link.provider,
        providerName: link.providerName,
        title: link.sourceTitle,
        titleKey,
        canonical: link.canonical,
        url: link.url,
        sourceRows: new Set(),
        links: []
      }
      groups.set(key, group)
    }
    group.links.push(link)
    for (const row of link.rows) group.sourceRows.add(row)
  }
  return { groups: [...groups.values()], withoutTitle }
}

async function scanAccountTree(account, provider, warnings) {
  const items = []
  const errors = []
  const visited = new Set(['/'])
  let frontier = [{ path: '/', depth: 1 }]
  let directories = 0
  let truncated = false

  while (frontier.length) {
    if (directories >= DELIST_SCAN_MAX_DIRECTORIES || items.length >= DELIST_SCAN_MAX_ITEMS) {
      truncated = true
      break
    }

    const currentDepth = frontier[0].depth
    const remainingDirectories = DELIST_SCAN_MAX_DIRECTORIES - directories
    const batch = frontier.slice(0, remainingDirectories)
    if (frontier.length > batch.length) truncated = true
    directories += batch.length

    const batches = await mapLimit(batch, 4, async (current) => {
      try {
        return { current, rows: await provider.list(account, current.path) }
      } catch (err) {
        return { current, error: err }
      }
    })

    const nextFrontier = []
    for (const result of batches) {
      if (result.error) {
        errors.push(`${result.current.path === '/' ? '根目录' : result.current.path}读取失败：${result.error.message || '未知错误'}`)
        continue
      }
      for (const row of Array.isArray(result.rows) ? result.rows : []) {
        const name = String(row?.name || '').trim()
        const path = String(row?.path || '').trim()
        if (!name || !path) continue
        const item = {
          accountId: account.id,
          accountLabel: account.label,
          provider: account.provider,
          providerName: provider.name,
          name,
          path,
          type: row.type === 'dir' ? 'dir' : 'file',
          size: Number(row.size || 0),
          mtime: Number(row.mtime || 0)
        }
        items.push(item)
        if (items.length >= DELIST_SCAN_MAX_ITEMS) {
          truncated = true
          break
        }
        if (
          item.type === 'dir' &&
          currentDepth < DELIST_SCAN_DEPTH &&
          !visited.has(path)
        ) {
          visited.add(path)
          nextFrontier.push({ path, depth: currentDepth + 1 })
        }
      }
      if (items.length >= DELIST_SCAN_MAX_ITEMS) break
    }
    frontier = nextFrontier
  }

  if (truncated) {
    warnings.push({
      accountId: account.id,
      accountLabel: account.label,
      provider: account.provider,
      providerName: provider.name,
      error: `目录较多，仅扫描前 ${directories} 个目录，未匹配项将继续通过网盘搜索查找`
    })
  }
  if (errors.length) {
    warnings.push({
      accountId: account.id,
      accountLabel: account.label,
      provider: account.provider,
      providerName: provider.name,
      error: errors.slice(0, 2).join('；')
    })
  }
  return items
}

export async function buildDelistPreview(userId, parsed, options = {}) {
  const loadAccounts = options.listAccounts || listAccounts
  const resolveProvider = options.getProvider || getProvider
  const accounts = (await loadAccounts(userId))
    .filter((account) => ['baidu', 'quark'].includes(account.provider) && account.cookie)
  const accountsByProvider = new Map()
  for (const account of accounts) {
    const list = accountsByProvider.get(account.provider) || []
    list.push(account)
    accountsByProvider.set(account.provider, list)
  }

  const { groups, withoutTitle } = groupLinksForDelist(parsed.links)
  const warnings = []
  const entries = []
  const unmatched = []
  const entriesByTarget = new Map()
  const needsScan = []

  const addMatch = (group, item, matchMethod) => {
    const targetKey = `${item.accountId}\0${item.path}`
    const existing = entriesByTarget.get(targetKey)
    if (existing) {
      existing.recordCount += group.links.length
      existing.sourceRows = [...new Set([...existing.sourceRows, ...group.sourceRows])]
      existing.sourceTitles = [...new Set([...existing.sourceTitles, group.title])]
      if (matchMethod === 'exact') existing.matchMethod = 'exact'
      return
    }
    const entry = {
      id: targetKey,
      accountId: item.accountId,
      accountLabel: item.accountLabel || '未命名账号',
      provider: item.provider,
      providerName: item.providerName,
      name: item.name,
      path: item.path,
      type: item.type,
      size: item.size,
      mtime: item.mtime,
      matchMethod,
      sourceTitle: group.title,
      sourceTitles: [group.title],
      sourceRows: [...group.sourceRows],
      recordCount: group.links.length
    }
    entries.push(entry)
    entriesByTarget.set(targetKey, entry)
  }

  const addUnmatched = (group, reason) => {
    unmatched.push({
      canonical: group.canonical,
      provider: group.provider,
      providerName: group.providerName,
      sourceTitle: group.title,
      sourceRows: [...group.sourceRows],
      linkCount: group.links.length,
      url: group.url,
      reason
    })
  }

  // Search is cheaper than walking every directory. Any title that search
  // cannot resolve is then checked against the real netdisk tree.
  const searchTasks = []
  const needsScanKeys = new Set()
  for (const group of groups) {
    const providerAccounts = accountsByProvider.get(group.provider) || []
    if (!providerAccounts.length) {
      addUnmatched(group, `未添加可用的${group.providerName}账号，无法扫描网盘文件`)
      continue
    }

    const provider = resolveProvider(group.provider)
    if (!provider.canSearch) {
      needsScanKeys.add(group.key)
      needsScan.push(group)
      continue
    }
    for (const account of providerAccounts) {
      searchTasks.push({ group, account, provider })
    }
  }

  const foundGroups = new Set()
  const searchResults = await mapLimit(searchTasks, 4, async ({ group, account, provider }) => {
    try {
      const rows = await provider.search(account, group.title.slice(0, 120), {
        limit: DELIST_SEARCH_LIMIT
      })
      const matches = []
      const seenPaths = new Set()
      for (const row of Array.isArray(rows) ? rows : []) {
        const matchMethod = matchMethodForTitle(group.title, row.name)
        if (!matchMethod || !row.path) continue
        const path = String(row.path)
        if (seenPaths.has(path)) continue
        seenPaths.add(path)
        matches.push({
          item: {
            accountId: account.id,
            accountLabel: account.label,
            provider: account.provider,
            providerName: provider.name,
            name: String(row.name || ''),
            path,
            type: row.type === 'dir' ? 'dir' : 'file',
            size: Number(row.size || 0),
            mtime: Number(row.mtime || 0)
          },
          matchMethod
        })
      }
      return { group, matches }
    } catch (err) {
      return {
        group,
        matches: [],
        warning: {
          accountId: account.id,
          accountLabel: account.label,
          provider: account.provider,
          providerName: provider.name,
          error: `搜索“${group.title}”失败：${err.message || '未知错误'}`
        }
      }
    }
  })

  for (const result of searchResults) {
    if (result.warning) warnings.push(result.warning)
    if (!result.matches.length) continue
    foundGroups.add(result.group.key)
    for (const match of result.matches) addMatch(result.group, match.item, match.matchMethod)
  }
  for (const group of groups) {
    if (!foundGroups.has(group.key) && !needsScanKeys.has(group.key) && (accountsByProvider.get(group.provider) || []).length) {
      needsScanKeys.add(group.key)
      needsScan.push(group)
    }
  }

  const scanAccounts = accounts.filter((account) =>
    needsScan.some((group) => group.provider === account.provider)
  )
  const scanResults = await mapLimit(scanAccounts, 2, async (account) => {
    const provider = resolveProvider(account.provider)
    if (!provider.canFiles) {
      warnings.push({
        accountId: account.id,
        accountLabel: account.label,
        provider: account.provider,
        providerName: provider.name,
        error: `${provider.name} 暂不支持扫描文件目录`
      })
      return []
    }
    return scanAccountTree(account, provider, warnings)
  })
  const scannedItems = scanResults.flat()

  for (const group of needsScan) {
    const matches = scannedItems
      .filter((item) => item.provider === group.provider)
      .map((item) => ({
        item,
        matchMethod: matchMethodForTitle(group.title, item.name)
      }))
      .filter((match) => match.matchMethod)

    if (!matches.length) {
      addUnmatched(
        group,
        `已搜索${group.providerName}，并扫描账号的 1-3 级目录，未找到同名文件或文件夹`
      )
      continue
    }
    for (const match of matches) addMatch(group, match.item, match.matchMethod)
  }

  for (const link of withoutTitle) {
    unmatched.push({
      canonical: link.canonical,
      provider: link.provider,
      providerName: link.providerName,
      sourceTitle: '表格缺少资源名称',
      sourceRows: link.rows,
      linkCount: 1,
      url: link.url,
      reason: '无法仅凭分享链接确定网盘内文件名称'
    })
  }

  entries.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  return {
    summary: {
      rows: parsed.totalRows,
      sheets: parsed.sheets.length,
      links: parsed.links.length,
      matched: entries.length,
      unmatched: unmatched.length,
      baidu: entries.filter((entry) => entry.provider === 'baidu').length,
      quark: entries.filter((entry) => entry.provider === 'quark').length,
      accounts: accounts.length,
      scannedItems: scannedItems.length
    },
    entries,
    unmatched,
    warnings
  }
}
