import { createCliRenderer, type CliRenderer, type CliRendererConfig } from '@opentui/core';

export interface OpenTuiLifecycle {
  readonly renderer: CliRenderer;
  dispose(): Promise<void>;
}

export async function createOpenTuiLifecycle(config: CliRendererConfig = {}): Promise<OpenTuiLifecycle> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    clearOnShutdown: true,
    ...config,
  });
  let disposed = false;
  return {
    renderer,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      renderer.destroy();
      await (renderer as CliRenderer & { closed?: Promise<void> }).closed;
    },
  };
}
