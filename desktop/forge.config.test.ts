// @vitest-environment node

import path from 'node:path';

import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { describe, expect, it } from 'vitest';

import config from './forge.config';

describe('Electron Forge configuration', () => {
  it('uses a flat Windows-safe NuGet package name for Squirrel', async () => {
    const squirrel = config.makers?.find((maker) => maker instanceof MakerSquirrel);
    if (!(squirrel instanceof MakerSquirrel)) throw new Error('Squirrel maker is not configured');
    await squirrel.prepareConfig('x64');

    const packageName = squirrel.config.name;
    expect(packageName).toBe('AllChat');
    expect(path.win32.dirname(path.win32.join('C:\\temp\\squirrel', `${packageName}.nuspec`)))
      .toBe('C:\\temp\\squirrel');
  });
});
