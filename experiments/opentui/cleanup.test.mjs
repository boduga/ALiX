import assert from 'node:assert/strict'
import test from 'node:test'
import { withTestRenderer } from './harness.mjs'
import { mountWorkbench } from './static-workbench.mjs'

test('native renderer cleanup is idempotent', async () => {
  await withTestRenderer({ width: 80, height: 20 }, async (setup) => {
    mountWorkbench(setup.renderer)
    await setup.renderOnce()
    setup.renderer.destroy()
    setup.renderer.destroy()
    assert.ok(true)
  })
})
