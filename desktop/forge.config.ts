import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerWix } from '@electron-forge/maker-wix';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const windowsInstallerUI = fileURLToPath(new URL('./installer/windows-ui.xml', import.meta.url));
const windowsInstallerUIXML = readFileSync(windowsInstallerUI, 'utf8');
const windowsInstallerIcon = fileURLToPath(new URL('./installer/allchat.ico', import.meta.url));

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: 'AllChat',
  },
  makers: [
    new MakerWix({
      name: 'AllChat',
      manufacturer: 'AllChat contributors',
      description: 'Native desktop client for AllChat',
      exe: 'AllChat.exe',
      icon: windowsInstallerIcon,
      programFilesFolderName: 'AllChat',
      shortcutFolderName: 'AllChat',
      shortcutName: 'AllChat',
      upgradeCode: '6D524E61-564A-4E39-9D24-0A6D7B4D27EA',
      ui: { chooseDirectory: true, template: windowsInstallerUIXML },
    }),
    new MakerZIP({}, ['darwin', 'linux']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/main.ts', config: 'vite.main.config.mts', target: 'main' },
        { entry: 'src/preload/preload.ts', config: 'vite.preload.config.mts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.mts' }],
    }),
  ],
};

export default config;
