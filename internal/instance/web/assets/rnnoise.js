(() => {
  "use strict";
  let installed;
  const install = context => installed ||= context.audioWorklet.addModule("/assets/rnnoise-worklet.js");
  const createNode = async context => {
    await install(context);
    const node = new AudioWorkletNode(context, "allchat-rnnoise", {channelCount: 1, channelCountMode: "explicit", outputChannelCount: [1]});
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("RNNoise initialization timed out")), 10000);
      node.port.onmessage = event => {
        if (event.data?.type === "ready") { clearTimeout(timeout); resolve(); }
        if (event.data?.type === "error") { clearTimeout(timeout); reject(new Error(event.data.message || "RNNoise initialization failed")); }
      };
    });
    return node;
  };
  window.AllChatRNNoise = {createNode};
})();
