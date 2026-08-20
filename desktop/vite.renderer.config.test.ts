import { describe, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';

import rendererConfig from './vite.renderer.config.mts';

describe('desktop renderer production bundle', () => {
  it('uses the AudioWorklet-compatible RNNoise runtime', async () => {
    const result = await build({
      ...rendererConfig,
      configFile: false,
      logLevel: 'silent',
      build: { ...rendererConfig.build, write: false },
    }) as Rollup.RollupOutput;
    const worklet = result.output.find((entry) => entry.fileName.includes('rnnoise-worklet'));
    const source = worklet?.type === 'chunk' ? worklet.code : String(worklet?.source || '');

    expect(source).toContain('allchat-desktop-rnnoise');
    expect(source).toContain('typeof globalThis');
    expect(source).not.toContain('typeof WorkerGlobalScope');
  });
});
