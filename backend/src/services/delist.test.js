import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import {
  buildDelistPreview,
  extractShareLinks,
  parseShareUrl,
  parseXlsxWorkbook
} from './delist.js'

function workbookBuffer() {
  const files = {
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="资源" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <si><t>资源甲</t></si>
        <si><r><t>资源</t></r><r><t>乙</t></r></si>
      </sst>`),
    // Some exporters write an incorrect dimension even though every row is present.
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <dimension ref="A1"/>
        <sheetData>
          <row r="1">
            <c r="A1" t="inlineStr"><is><t>商品标题</t></is></c>
            <c r="B1" t="inlineStr"><is><t>模版内容</t></is></c>
            <c r="C1" t="inlineStr"><is><t>发货附言</t></is></c>
          </row>
          <row r="2">
            <c r="A2" t="s"><v>0</v></c>
            <c r="B2" t="inlineStr"><is><t>https://pan.baidu.com/s/1abc?pwd=QWER https://pan.baidu.com/s/1abc?from=copy</t></is></c>
            <c r="C2" t="inlineStr"><is><t>链接 https://pan.quark.cn/s/Quark88 提取码: 7K2X</t></is></c>
          </row>
          <row r="3">
            <c r="A3" t="s"><v>1</v></c>
            <c r="B3" t="inlineStr"><is><t>https://pan.baidu.com/s/1xyz。 https://pan.xunlei.com/s/NotSupported</t></is></c>
          </row>
          <row r="4">
            <c r="A4" t="inlineStr"><is><t>资源丙</t></is></c>
            <c r="B4" t="inlineStr"><is><t>https://pan.quark.cn/s/Quark88?pwd=ABCD</t></is></c>
          </row>
        </sheetData>
      </worksheet>`)
  }
  return Buffer.from(zipSync(files))
}

test('parses XLSX rows without relying on the dimension declaration', () => {
  const workbook = parseXlsxWorkbook(workbookBuffer())

  assert.equal(workbook.length, 1)
  assert.equal(workbook[0].name, '资源')
  assert.equal(workbook[0].rows.length, 4)
  assert.equal(workbook[0].rows[2].values[0], '资源乙')
})

test('extracts and deduplicates supported share links', () => {
  const parsed = extractShareLinks(parseXlsxWorkbook(workbookBuffer()))

  assert.equal(parsed.totalRows, 3)
  assert.equal(parsed.links.length, 3)
  assert.deepEqual(
    parsed.links.map((link) => link.canonical).sort(),
    ['baidu:1abc', 'baidu:1xyz', 'quark:Quark88']
  )

  const quark = parsed.links.find((link) => link.provider === 'quark')
  assert.equal(quark.sourceTitle, '资源甲')
  assert.equal(quark.passcode, '7K2X')
  assert.deepEqual(quark.rows, [2, 4])
  assert.deepEqual(quark.columns, ['发货附言', '模版内容'])
  assert.equal(quark.occurrences, 2)

  const baidu = parsed.links.find((link) => link.key === '1abc')
  assert.equal(baidu.occurrences, 2)
  assert.equal(baidu.passcode, 'QWER')
})

test('share URL normalization ignores query strings and unsupported providers', () => {
  assert.deepEqual(parseShareUrl('https://pan.baidu.com/s/1abc?pwd=9XYZ'), {
    provider: 'baidu',
    providerName: '百度网盘',
    key: '1abc',
    canonical: 'baidu:1abc'
  })
  assert.equal(parseShareUrl('https://pan.xunlei.com/s/NotSupported'), null)
  assert.equal(parseShareUrl('https://example.com/s/not-supported'), null)
})

test('opens share links and matches names within the first two folder levels', async () => {
  const account = {
    id: 'account-baidu-1',
    userId: 'user-1',
    provider: 'baidu',
    label: '百度主账号',
    cookie: 'cookie'
  }
  const tree = {
    '/': [
      { name: '转存', path: '/转存', type: 'dir' }
    ],
    '/转存': [
      { name: '资源甲', path: '/转存/资源甲', type: 'dir' },
      { name: '资源乙 (2)', path: '/转存/资源乙 (2)', type: 'dir' },
      { name: '更深一层', path: '/转存/更深一层', type: 'dir' },
      { name: '无关资源', path: '/转存/无关资源', type: 'dir' }
    ],
    '/转存/更深一层': [
      { name: '资源丙', path: '/转存/更深一层/资源丙', type: 'dir' }
    ]
  }
  let shareCalls = 0
  const provider = {
    name: '百度网盘',
    canFiles: true,
    async list(_account, path) {
      return tree[path] || []
    },
    async shareNames(_account, link) {
      shareCalls++
      return {
        title: link.key === 'c' ? '资源乙' : link.key === 'd' ? '资源丙' : '资源甲',
        names: []
      }
    }
  }
  const parsed = {
    totalRows: 4,
    sheets: ['资源'],
    links: [
      {
        canonical: 'baidu:a',
        provider: 'baidu',
        providerName: '百度网盘',
        key: 'a',
        url: 'https://pan.baidu.com/s/a',
        sourceTitle: '表格商品标题甲',
        passcode: '',
        rows: [2]
      },
      {
        canonical: 'baidu:b',
        provider: 'baidu',
        providerName: '百度网盘',
        key: 'b',
        url: 'https://pan.baidu.com/s/b',
        sourceTitle: '表格商品标题乙',
        passcode: '',
        rows: [3]
      },
      {
        canonical: 'baidu:c',
        provider: 'baidu',
        providerName: '百度网盘',
        key: 'c',
        url: 'https://pan.baidu.com/s/c',
        sourceTitle: '表格商品标题丙',
        passcode: '',
        rows: [4]
      },
      {
        canonical: 'baidu:d',
        provider: 'baidu',
        providerName: '百度网盘',
        key: 'd',
        url: 'https://pan.baidu.com/s/d',
        sourceTitle: '表格商品标题丁',
        passcode: '',
        rows: [5]
      }
    ]
  }

  const result = await buildDelistPreview('user-1', parsed, {
    listAccounts: async () => [account],
    getProvider: () => provider
  })

  assert.equal(result.summary.matched, 2)
  assert.equal(result.summary.unmatched, 1)
  assert.equal(shareCalls, 4)
  const exact = result.entries.find((entry) => entry.name === '资源甲')
  assert.equal(exact.path, '/转存/资源甲')
  assert.equal(exact.accountId, account.id)
  assert.equal(exact.matchMethod, 'exact')
  assert.equal(exact.recordCount, 2)
  assert.deepEqual(exact.sourceRows, [2, 3])
  assert.equal(result.entries.find((entry) => entry.name === '资源乙 (2)').matchMethod, 'copy')
  assert.equal(result.entries.some((entry) => entry.name === '资源丙'), false)
})
