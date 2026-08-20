// @vitest-environment node

import fs from 'node:fs';

import { MakerWix } from '@electron-forge/maker-wix';
import { describe, expect, it } from 'vitest';

import config from './forge.config';

describe('Electron Forge configuration', () => {
  it('builds a traditional Windows wizard with directory and launch choices', async () => {
    const wix = config.makers?.find((maker) => maker instanceof MakerWix);
    if (!(wix instanceof MakerWix)) throw new Error('WiX maker is not configured');
    await wix.prepareConfig('x64');

    expect(wix.config.ui).toMatchObject({ chooseDirectory: true });
    expect(wix.config.upgradeCode).toBe('6D524E61-564A-4E39-9D24-0A6D7B4D27EA');
    const template = typeof wix.config.ui === 'object' ? wix.config.ui.template : undefined;
    expect(template).toBeTruthy();
    const xml = fs.readFileSync(template!, 'utf8');
    expect(xml).toContain('WIXUI_EXITDIALOGOPTIONALCHECKBOXTEXT" Value="Launch AllChat"');
    expect(xml).toContain('DialogRef Id="ProgressDlg"');
    expect(xml).toContain('Event="DoAction" Value="LaunchAllChat"');
  });
});
