import assert from 'node:assert/strict'
import test from 'node:test'
import { withTestRenderer } from './harness.mjs'
import { mountWorkbench } from './static-workbench.mjs'

test('renderer accepts changed terminal dimensions', async () => {
  await withTestRenderer({ width: 120, height: 30 }, async (setup) => {
    mountWorkbench(setup.renderer)
    await setup.renderOnce()
    setup.resize(90, 24)
    await setup.renderOnce()
    assert.equal(setup.renderer.width, 90)
    assert.equal(setup.renderer.height, 24)
    assert.ok(setup.captureCharFrame().includes('Transcript'))
  })
})
