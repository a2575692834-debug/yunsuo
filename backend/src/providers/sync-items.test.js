import assert from 'node:assert/strict'
import test from 'node:test'
import { selectMissingSyncItems } from './sync-items.js'

test('incremental sync keeps only source items missing from the destination', () => {
  const source = [
    { name: '23超清4K.mp4', fsId: 'source-23' },
    { name: '24超清4K.mp4', fsId: 'source-24' },
    { name: '25.mp4', fsId: 'source-25' }
  ]
  const destination = [
    { name: '23超清4K.mp4' },
    { name: '23超清4K(1).mp4' },
    { name: '24超清4K.mp4' },
    { name: '24超清4K(1).mp4' }
  ]

  assert.deepEqual(
    selectMissingSyncItems(source, destination).map((item) => item.fsId),
    ['source-25']
  )
})

test('incremental sync ignores the share root container', () => {
  const source = [
    { name: '共驻', type: 'dir' },
    { name: '25.mp4', type: 'file' }
  ]

  assert.deepEqual(
    selectMissingSyncItems(source, [], { sourceName: '共驻' }).map((item) => item.name),
    ['25.mp4']
  )
})

test('incremental sync skips the transfer when every source item already exists', () => {
  const source = [
    { name: '23超清4K.mp4' },
    { name: '24超清4K.mp4' }
  ]
  const destination = [
    { name: '23超清4K.mp4' },
    { name: '24超清4K.mp4' }
  ]

  assert.deepEqual(selectMissingSyncItems(source, destination), [])
})
