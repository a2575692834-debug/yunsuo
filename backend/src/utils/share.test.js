import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveShareExpiry, resolveSharePasscode } from './share.js'

test('share expiry defaults to permanent', () => {
  assert.deepEqual(resolveShareExpiry(), { unlimited: true, expires: 0 })
  assert.deepEqual(resolveShareExpiry({}), { unlimited: true, expires: 0 })
})

test('share expiry accepts explicit days and explicit permanent mode', () => {
  assert.deepEqual(resolveShareExpiry({ expires: 30 }), { unlimited: false, expires: 30 })
  assert.deepEqual(resolveShareExpiry({ unlimited: true, expires: 30 }), { unlimited: true, expires: 0 })
})

test('other providers default to 8888 while Quark is always passcode-free', () => {
  assert.equal(resolveSharePasscode(undefined), '8888')
  assert.equal(resolveSharePasscode(undefined, 'baidu'), '8888')
  assert.equal(resolveSharePasscode(undefined, 'quark'), '')
  assert.equal(resolveSharePasscode('ab12', 'quark'), '')
  assert.equal(resolveSharePasscode(''), '')
  assert.equal(resolveSharePasscode('ab12'), 'AB12')
})
