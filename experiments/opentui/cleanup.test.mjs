import assert from 'node:assert/strict'
import test from 'node:test'
import { createTestRenderer } from '@opentui/core/testing'
import { mountWorkbench } from './static-workbench.mjs'

test('native renderer cleanup is idempotent', async () => {
  const setup = await createTestRenderer({ width: 80, height: 20 })
  mountWorkbench(setup.renderer)
  await setup.renderOnce()
  setup.renderer.destroy()
  setup.renderer.destroy()
  await setup.renderer.closed
  assert.ok(true)
})
