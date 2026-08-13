import {Rnnoise} from "/assets/vendor/rnnoise.js";

class AllChatRNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = 480;
    this.input = new Float32Array(this.frameSize);
    this.output = new Float32Array(this.frameSize);
    this.inputSize = 0;
    this.outputRead = this.frameSize;
    this.destroyed = false;
    this.port.onmessage = event => { if (event.data?.type === "destroy") { this.destroyed = true; this.state?.destroy(); this.state = null; } };
    Rnnoise.load().then(engine => {
      if (engine.frameSize !== this.frameSize) throw new Error(`Unsupported RNNoise frame size: ${engine.frameSize}`);
      this.state = engine.createDenoiseState();
      this.port.postMessage({type: "ready"});
    }).catch(error => this.port.postMessage({type: "error", message: error?.message || String(error)}));
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

registerProcessor("allchat-rnnoise", AllChatRNNoiseProcessor);
