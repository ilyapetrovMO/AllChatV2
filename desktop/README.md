# AllChat Desktop

This directory contains the Windows-first Electron and React Desktop Client foundation.

```sh
npm install
npm run test:desktop
npm run build:desktop
npm start --workspace @allchat/desktop
```

The renderer loads bundled local code and reaches native behavior only through `DesktopBridge`. Instance Profiles are intentionally non-secret; future Desktop Device Session credentials belong in an operating-system credential-vault adapter owned by the main process.

The current Canary foundation renders the shell and proves the security and Instance-isolation seams. Instance networking, persisted profiles, credential-vault integration, and feature parity are tracked as subsequent native-desktop issues.
