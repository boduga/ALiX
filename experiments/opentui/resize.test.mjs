import assert from 'node:assert/strict'
import test from 'node:test'
import { createTestRenderer } from '@opentui/core/testing'
import { mountWorkbench } from './static-workbench.mjs'

test('renderer accepts changed terminal dimensions', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 })
  try {
    mountWorkbench(setup.renderer)
    await setup.renderOnce()
    setup.resize(90, 24)
    await setup.renderOnce()
    assert.equal(setup.renderer.width, 90)
    assert.equal(setup.renderer.height, 24)
    assert.ok(setup.captureCharFrame().includes('Transcript'))
  } finally {
    setup.renderer.destroy()
    await setup.renderer.closed
  }
})
