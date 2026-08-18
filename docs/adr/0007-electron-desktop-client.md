# Build the Desktop Client as a hardened Electron shell around shared React UI

AllChat will build its Desktop Client with Electron and React. The renderer will load only bundled AllChat code and will share Member-facing UI and domain behavior with the web client; it will not embed an Instance's remotely served interface. Electron's main process will own operating-system integration, Instance connections, notification decisions, and credential references, while renderers receive a small typed bridge through an isolated, sandboxed preload context.

One trusted shell window will host an Instance rail and an isolated view for each active Instance. Each Instance gets a persistent, namespaced browser partition and a stable local Instance Profile. Raw Desktop Device Session credentials remain in the operating-system credential vault and never enter a renderer. The first release uses Chromium WebRTC and adds native media modules only where measured gaps justify their security and maintenance cost.

This accepts Electron's larger distribution size and Chromium update burden in exchange for visual and behavioral parity with the web client, React code sharing, mature Windows integration, and a practical path to macOS and Linux. React Native remains a separate mobile presentation layer while sharing versioned contracts and domain behavior where practical.
