// @vitest-environment node

import fs from 'node:fs';

import { MakerWix } from '@electron-forge/maker-wix';
import { describe, expect, it } from 'vitest';

import config from './forge.config';

describe('Electron Forge configuration', () => {
  it('packages native application icons for Windows and macOS', () => {
    const icon = config.packagerConfig?.icon;
    expect(typeof icon).toBe('string');
    expect(icon).toMatch(/installer[\\/]allchat$/);
    expect(fs.readFileSync(`${icon}.ico`).subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
    expect(fs.readFileSync(`${icon}.icns`).subarray(0, 4).toString('ascii')).toBe('icns');
    expect(config.packagerConfig?.extraResource).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/allchat-icon\.png$/),
        expect.stringMatching(/allchat\.ico$/),
      ]),
    );

    const ico = fs.readFileSync(`${icon}.ico`);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(8);
    expect([...Array(ico.readUInt16LE(4))].map((_, index) => ico[6 + index * 16] || 256))
      .toEqual(expect.arrayContaining([16, 20, 24, 32, 40, 48, 64, 128, 256]));
  });

  it('builds a traditional Windows wizard with directory and launch choices', async () => {
    const wix = config.makers?.find((maker) => maker instanceof MakerWix);
    if (!(wix instanceof MakerWix)) throw new Error('WiX maker is not configured');
    await wix.prepareConfig('x64');

    expect(wix.config.ui).toMatchObject({ chooseDirectory: true });
    expect(wix.config.upgradeCode).toBe('6D524E61-564A-4E39-9D24-0A6D7B4D27EA');
    expect(wix.config.icon).toMatch(/\.ico$/);
    expect(fs.readFileSync(wix.config.icon!).subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
    const template = typeof wix.config.ui === 'object' ? wix.config.ui.template : undefined;
    expect(template).toBeTruthy();
    expect(template!.trimStart()).toMatch(/^</);
    const xml = template!;
    expect(xml).toContain('WIXUI_EXITDIALOGOPTIONALCHECKBOXTEXT" Value="Launch AllChat"');
    expect(xml).toContain('DialogRef Id="ProgressDlg"');
    expect(xml).toContain('Event="DoAction" Value="LaunchAllChat"');
  });
});
