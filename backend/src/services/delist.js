import { strFromU8, unzipSync } from 'fflate'
import { listResourcesForDelist } from '../db.js'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024
const MAX_SHEETS = 20
const MAX_CELLS = 100_000
const MAX_LINKS = 5_000

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

export async function buildDelistPreview(userId, parsed) {
  const resources = (await listResourcesForDelist(userId))
    .filter((resource) =>
      ['baidu', 'quark'].includes(resource.provider) &&
      resource.savedPath &&
      resource.accountId
    )

  const byUrl = new Map()
  for (const resource of resources) {
    const parsedUrl = parseShareUrl(resource.sourceUrl)
    if (!parsedUrl) continue
    const list = byUrl.get(parsedUrl.canonical) || []
    list.push(resource)
    byUrl.set(parsedUrl.canonical, list)
  }

  const entries = []
  const unmatched = []
  const seenResources = new Set()
  const entriesByLocation = new Map()

  for (const link of parsed.links) {
    let candidates = byUrl.get(link.canonical) || []
    let matchMethod = 'url'
    if (!candidates.length) {
      const title = normalizedTitle(link.sourceTitle)
      if (title) {
        candidates = resources.filter((resource) =>
          resource.provider === link.provider && normalizedTitle(resource.title) === title
        )
        matchMethod = 'title'
      }
    }

    candidates = candidates.filter((resource) => resource.provider === link.provider)
    if (!candidates.length) {
      unmatched.push({
        canonical: link.canonical,
        provider: link.provider,
        providerName: link.providerName,
        sourceTitle: link.sourceTitle || '未命名资源',
        url: link.url,
        reason: '资源库中没有匹配的转存记录'
      })
      continue
    }

    for (const resource of candidates) {
      if (seenResources.has(resource.id)) continue
      seenResources.add(resource.id)
      const locationKey = `${resource.accountId}\0${resource.savedPath}`
      const existing = entriesByLocation.get(locationKey)
      if (existing) {
        existing.recordCount++
        existing.sourceRows = [...new Set([...existing.sourceRows, ...link.rows])]
        if (matchMethod === 'url') existing.matchMethod = 'url'
        continue
      }
      const entry = {
        resourceId: resource.id,
        provider: resource.provider,
        providerName: resource.provider === 'baidu' ? '百度网盘' : '夸克网盘',
        sourceTitle: link.sourceTitle || '未命名资源',
        resourceTitle: resource.title || resource.savedPath.split('/').pop() || '未命名文件',
        savedPath: resource.savedPath,
        accountId: resource.accountId,
        accountLabel: resource.accountLabel || '未命名账号',
        matchMethod,
        sourceUrl: link.url,
        sourceRows: link.rows,
        recordCount: 1
      }
      entries.push(entry)
      entriesByLocation.set(locationKey, entry)
    }
  }

  entries.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
    return a.resourceTitle.localeCompare(b.resourceTitle, 'zh-CN')
  })

  return {
    summary: {
      rows: parsed.totalRows,
      sheets: parsed.sheets.length,
      links: parsed.links.length,
      matched: entries.length,
      unmatched: unmatched.length,
      baidu: entries.filter((entry) => entry.provider === 'baidu').length,
      quark: entries.filter((entry) => entry.provider === 'quark').length
    },
    entries,
    unmatched
  }
}
