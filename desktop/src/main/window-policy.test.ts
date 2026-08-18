import { describe, expect, it } from 'vitest';

import { createWindowOptions, isAllowedAppNavigation } from './window-policy';

describe('desktop window policy', () => {
  it('isolates and sandboxes the renderer without Node.js', () => {
    const options = createWindowOptions('/opt/allchat/preload.js');

    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: '/opt/allchat/preload.js',
    });
    expect(options.webPreferences?.partition).toBeUndefined();
  });

  it('allows only bundled app navigation', () => {
    expect(isAllowedAppNavigation('file:///opt/allchat/renderer/index.html')).toBe(true);
    expect(isAllowedAppNavigation('https://community.example/channels/general')).toBe(false);
    expect(isAllowedAppNavigation('javascript:alert(1)')).toBe(false);
  });
});
