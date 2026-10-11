import type { TestRendererSetup } from '@opentui/core/testing';

export async function disposeTestRenderer(setup: TestRendererSetup): Promise<void> {
  setup.renderer.destroy();
  await (setup.renderer as typeof setup.renderer & { closed: Promise<void> }).closed;
}
