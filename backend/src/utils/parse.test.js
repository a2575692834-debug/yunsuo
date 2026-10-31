import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMany, parseOne } from './parse.js'

test('parses a mixed share message and keeps each passcode with its own link', () => {
  const links = parseMany(`
第一条无提取码
https://pan.baidu.com/s/1NoCodeFirst
第二条有提取码
链接: https://pan.quark.cn/s/AbCd1234 提取码: 7K2X
第三条无提取码
https://pan.xunlei.com/s/VN9x2KpQr7
第四条有提取码
https://pan.baidu.com/s/1WithCode?pwd=QWER
  `)

  assert.deepEqual(links.map((link) => link.provider), ['baidu', 'quark', 'xunlei', 'baidu'])
  assert.deepEqual(links.map((link) => link.passcode), ['', '7K2X', '', 'QWER'])
})

test('does not leak a previous same-line passcode to the next code-less link', () => {
  const links = parseMany(
    'https://pan.baidu.com/s/1First 提取码: A1B2 https://pan.quark.cn/s/Second7788'
  )

  assert.equal(links[0].passcode, 'A1B2')
  assert.equal(links[1].passcode, '')
})

test('reads a passcode placed before the URL or on the following line', () => {
  const links = parseMany(`
提取码：M3N4
https://pan.quark.cn/s/BeforeCode
https://pan.xunlei.com/s/AfterCode001
密码: P9Q8
  `)

  assert.equal(links[0].passcode, 'M3N4')
  assert.equal(links[1].passcode, 'P9Q8')
})

test('parseOne keeps its existing single-link behavior', () => {
  const link = parseOne('链接: https://pan.baidu.com/s/1Single 提取码: 9ABC')
  assert.equal(link.provider, 'baidu')
  assert.equal(link.passcode, '9ABC')
})
