(() => {
  "use strict";
  let installed;
  const runtime = {engine: "rnnoise", version: "0.2-compatible", model: "full", status: "idle", contextSampleRate: 0, framesProcessed: 0, deadlineMisses: 0, fallbackReason: ""};
  const install = context => installed ||= context.audioWorklet.addModule("/assets/rnnoise-worklet.js");
  const createNode = async context => {
    runtime.status = "loading";
    runtime.contextSampleRate = context.sampleRate;
    runtime.fallbackReason = "";
    try { await install(context); }
    catch (error) { runtime.status = "failed"; runtime.fallbackReason = error?.message || String(error); throw error; }
    const node = new AudioWorkletNode(context, "allchat-rnnoise", {channelCount: 1, channelCountMode: "explicit", outputChannelCount: [1]});
    await new Promise((resolve, reject) => {
      const fail = error => { runtime.status = "failed"; runtime.fallbackReason = error.message; reject(error); };
      const timeout = setTimeout(() => fail(new Error("RNNoise initialization timed out")), 10000);
      node.port.onmessage = event => {
        if (event.data?.type === "ready") { clearTimeout(timeout); runtime.status = "ready"; resolve(); }
        if (event.data?.type === "error") { clearTimeout(timeout); fail(new Error(event.data.message || "RNNoise initialization failed")); }
        if (event.data?.type === "metrics") { runtime.framesProcessed = event.data.framesProcessed || 0; runtime.deadlineMisses = event.data.deadlineMisses || 0; runtime.contextSampleRate = event.data.sampleRate || context.sampleRate; }
      };
    });
    return node;
  };
  const diagnostics = () => ({...runtime});
  window.AllChatRNNoise = {createNode, diagnostics};
})();
