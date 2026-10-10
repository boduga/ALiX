import { createTestRenderer } from '@opentui/core/testing'

// Shared lifecycle for the native test renderer: destroy and await `closed`
// exactly once per created renderer, so each test and the benchmark cannot
// drift on teardown.
export async function disposeTestRenderer(setup) {
  setup.renderer.destroy()
  await setup.renderer.closed
}

export async function withTestRenderer(options, fn) {
  const setup = await createTestRenderer(options)
  try {
    return await fn(setup)
  } finally {
    await disposeTestRenderer(setup)
  }
}
