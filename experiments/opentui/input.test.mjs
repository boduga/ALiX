import assert from 'node:assert/strict'
import test from 'node:test'
import { createTestRenderer } from '@opentui/core/testing'
import { mountWorkbench } from './static-workbench.mjs'

test('focused composer receives mocked input', async () => {
  const setup = await createTestRenderer({ width: 100, height: 25 })
  try {
    const { input } = mountWorkbench(setup.renderer)
    input.focus()
    await setup.mockInput.typeText('build')
    await setup.renderOnce()
    assert.equal(input.value, 'build')
    assert.ok(setup.captureCharFrame().includes('build'))
  } finally {
    setup.renderer.destroy()
    await setup.renderer.closed
  }
})
