import assert from 'node:assert/strict'
import test from 'node:test'
import { withTestRenderer } from './harness.mjs'
import { WORKBENCH } from './workbench-fixture.mjs'
import { mountWorkbench } from './static-workbench.mjs'

test('native frame contains all Workbench regions and four agents', async () => {
  await withTestRenderer({ width: 120, height: 30 }, async (setup) => {
    mountWorkbench(setup.renderer)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    for (const label of [...WORKBENCH.regionTitles, ...WORKBENCH.agentNames]) {
      assert.ok(frame.includes(label), `missing ${label}`)
    }
  })
})
