import assert from 'node:assert/strict'
import test from 'node:test'
import { withTestRenderer } from './harness.mjs'
import { WORKBENCH } from './workbench-fixture.mjs'
import { mountWorkbench } from './static-workbench.mjs'

const LAYOUTS = [
  { name: 'wide', width: 180, height: 40 },
  { name: 'medium', width: 120, height: 30 },
  { name: 'narrow', width: 80, height: 24 },
]

for (const { name, width, height } of LAYOUTS) {
  test(`${name} (${width}x${height}) frame shows every region and agent`, async () => {
    await withTestRenderer({ width, height }, async (setup) => {
      mountWorkbench(setup.renderer)
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      for (const label of WORKBENCH.regionTitles) {
        assert.ok(frame.includes(label), `${name}: missing region ${label}`)
      }
      for (const agent of WORKBENCH.agentNames) {
        assert.ok(frame.includes(agent), `${name}: missing agent ${agent}`)
      }
    })
  })
}
