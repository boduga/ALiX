import assert from 'node:assert/strict'
import test from 'node:test'
import { createTestRenderer } from '@opentui/core/testing'
import { mountWorkbench } from './static-workbench.mjs'

test('native frame contains all Workbench regions and four agents', async () => {
  const setup = await createTestRenderer({ width: 120, height: 30 })
  try {
    mountWorkbench(setup.renderer)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    for (const label of ['Agents', 'Transcript', 'Inspector', 'Composer', 'Footer', 'orchestrator', 'frontend', 'backend', 'tests']) {
      assert.ok(frame.includes(label), `missing ${label}`)
    }
  } finally {
    setup.renderer.destroy()
    await setup.renderer.closed
  }
})
