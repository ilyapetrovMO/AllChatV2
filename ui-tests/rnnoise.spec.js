const {test, expect} = require('@playwright/test');

test('RNNoise AudioWorklet initializes and exposes runtime diagnostics', async ({page}) => {
  await page.goto('/login');
  await page.addScriptTag({url: '/assets/rnnoise.js'});
  const diagnostics = await page.evaluate(async () => {
    const context = new AudioContext({sampleRate: 48000});
    try {
      const node = await window.AllChatRNNoise.createNode(context);
      const oscillator = context.createOscillator();
      const sink = context.createGain();
      sink.gain.value = 0;
      oscillator.connect(node).connect(sink).connect(context.destination);
      oscillator.start();
      await context.resume();
      await new Promise(resolve => setTimeout(resolve, 1100));
      oscillator.stop();
      const state = window.AllChatRNNoise.diagnostics();
      node.port.postMessage({type: 'destroy'});
      return state;
    } finally {
      await context.close();
    }
  });
  expect(diagnostics).toMatchObject({engine: 'rnnoise', status: 'ready', contextSampleRate: 48000});
  expect(diagnostics.framesProcessed).toBeGreaterThan(0);
});

test('enhanced constraints retain AEC without stacking browser suppression', async ({page}) => {
  await page.goto('/login');
  await page.addScriptTag({url: '/assets/voice-settings.js'});
  const constraints = await page.evaluate(() => window.AllChatVoiceSettings.constraints({
    ...window.AllChatVoiceSettings.defaults,
    noiseSuppressionMode: 'enhanced',
  }));
  expect(constraints.echoCancellation).toBe(true);
  expect(constraints.noiseSuppression).toBe(false);
});
