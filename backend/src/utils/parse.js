const PROVIDERS = [
  {
    id: 'baidu',
    name: '百度网盘',
    pattern: /https?:\/\/(?:pan|yun)\.baidu\.com\/s\/([A-Za-z0-9_-]+)/i
  },
  {
    id: 'quark',
    name: '夸克网盘',
    pattern: /https?:\/\/pan\.quark\.cn\/s\/([A-Za-z0-9]+)/i
  },
  {
    id: 'xunlei',
    name: '迅雷网盘',
    pattern: /https?:\/\/pan\.xunlei\.com\/s\/([A-Za-z0-9_-]+)/i
  }
]

const URL_RE = /https?:\/\/[^\s"'<>，。；、]+/gi

const PASSCODE_PATTERNS = [
  /(?:提取码|密码|访问码)\s*[:：]?\s*([A-Za-z0-9]{4})/,
  /(?:pwd|passcode|code)\s*[:=]\s*([A-Za-z0-9]{4})/i
]

function passcodeFromUrl(url) {
  try {
    const u = new URL(url)
    const fromQuery = u.searchParams.get('pwd') || u.searchParams.get('passcode') || u.searchParams.get('code')
    if (fromQuery) return fromQuery
  } catch { /* ignore */ }
  return ''
}

function passcodeFromText(text) {
  for (const re of PASSCODE_PATTERNS) {
    const hit = text.match(re)
    if (hit) return hit[1]
  }
  return ''
}

function readPasscode(text, url) {
  return passcodeFromUrl(url) || passcodeFromText(text)
}

function readLinkPasscode(source, match, previousMatch, nextMatch) {
  const url = match[0]
  const urlEnd = match.index + url.length
  const fromUrl = passcodeFromUrl(url)
  if (fromUrl) return fromUrl

  const lineStart = source.lastIndexOf('\n', match.index - 1) + 1
  const nextBreak = source.indexOf('\n', urlEnd)
  const lineEnd = nextBreak === -1 ? source.length : nextBreak
  const nextUrlStart = nextMatch?.index ?? source.length
  const afterUrl = source.slice(urlEnd, Math.min(lineEnd, nextUrlStart))
  let passcode = passcodeFromText(afterUrl)
  if (passcode) return passcode

  const previousUrlEnd = previousMatch ? previousMatch.index + previousMatch[0].length : -1
  if (previousUrlEnd < lineStart) {
    const beforeUrl = source.slice(lineStart, match.index)
    passcode = passcodeFromText(beforeUrl)
    if (passcode) return passcode
  }

  const following = source.slice(lineEnd + 1, nextUrlStart)
  const followingLines = following.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 2)
  passcode = passcodeFromText(followingLines.join('\n'))
  if (passcode) return passcode

  const previousLineEnd = lineStart - 1
  if (previousLineEnd > 0) {
    const previousLineStart = source.lastIndexOf('\n', previousLineEnd - 1) + 1
    const previousLine = source.slice(previousLineStart, previousLineEnd)
    if (!URL_RE.test(previousLine)) {
      return passcodeFromText(previousLine)
    }
  }
  return ''
}

export function parseOne(text) {
  const source = String(text || '')
  for (const raw of source.match(URL_RE) || []) {
    for (const p of PROVIDERS) {
      const hit = raw.match(p.pattern)
      if (hit) {
        return {
          provider: p.id,
          providerName: p.name,
          url: raw,
          key: hit[1],
          passcode: readPasscode(source, raw)
        }
      }
    }
  }
  return null
}

export function parseMany(text) {
  const source = String(text || '')
  const seen = new Set()
  const out = []
  const matches = [...source.matchAll(new RegExp(URL_RE.source, 'gi'))]
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const raw = match[0]
    if (seen.has(raw)) continue
    for (const p of PROVIDERS) {
      const hit = raw.match(p.pattern)
      if (hit) {
        seen.add(raw)
        out.push({
          provider: p.id,
          providerName: p.name,
          url: raw,
          key: hit[1],
          passcode: readLinkPasscode(source, match, matches[i - 1], matches[i + 1])
        })
        break
      }
    }
  }
  return out
}
