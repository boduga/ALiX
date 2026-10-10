import assert from 'node:assert/strict'
import test from 'node:test'
import { withTestRenderer } from './harness.mjs'
import { mountWorkbench } from './static-workbench.mjs'

test('focused composer receives mocked input', async () => {
  await withTestRenderer({ width: 100, height: 25 }, async (setup) => {
    const { input } = mountWorkbench(setup.renderer)
    input.focus()
    await setup.mockInput.typeText('build')
    await setup.renderOnce()
    assert.equal(input.value, 'build')
    assert.ok(setup.captureCharFrame().includes('build'))
  })
})
