// AudioWorklet globals are provided by Chromium at runtime, outside the DOM typings.
// @ts-nocheck
// The upstream loader rejects AudioWorkletGlobalScope because it exposes
// neither `window` nor `WorkerGlobalScope`. The prepared runtime keeps the
// pinned dependency intact except for its reviewed global-scope check.
import { Rnnoise } from '../../../internal/instance/web/assets/vendor/rnnoise.js';

class AllChatDesktopRNNoiseProcessor extends AudioWorkletProcessor {
  frameSize = 480;
  input = new Float32Array(this.frameSize);
  output = new Float32Array(this.frameSize);
  inputSize = 0;
  outputRead = this.frameSize;
  state = null;
  destroyed = false;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data?.type === 'destroy') {
        this.destroyed = true;
        this.state?.destroy();
        this.state = null;
      }
    };
    Rnnoise.load().then((engine) => {
      if (engine.frameSize !== this.frameSize) throw new Error(`Unsupported RNNoise frame size: ${engine.frameSize}`);
      this.state = engine.createDenoiseState();
      this.port.postMessage({ type: 'ready' });
    }).catch((error) => this.port.postMessage({ type: 'error', message: error?.message || String(error) }));
  }

  process(inputs, outputs) {
    if (this.destroyed) return false;
    const source = inputs[0]?.[0], target = outputs[0]?.[0];
    if (!target) return true;
    if (!source || !this.state) { target.fill(0); return true; }
    for (let index = 0; index < target.length; index += 1) {
      this.input[this.inputSize++] = source[index] * 32768;
      target[index] = this.outputRead < this.frameSize ? this.output[this.outputRead++] / 32768 : 0;
      if (this.inputSize === this.frameSize) {
        this.inputSize = 0;
        this.output.set(this.input);
        this.state.processFrame(this.output);
        this.outputRead = 0;
      }
    }
    return true;
  }
}

registerProcessor('allchat-desktop-rnnoise', AllChatDesktopRNNoiseProcessor);
