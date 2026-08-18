import { describe, expect, it } from 'vitest';

import { createWindowOptions, isAllowedAppNavigation, isAllowedExternalNavigation } from './window-policy';

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

  it('opens only ordinary HTTP links in the external browser', () => {
    expect(isAllowedExternalNavigation('https://example.com/docs?q=desktop')).toBe(true);
    expect(isAllowedExternalNavigation('http://example.com/')).toBe(true);
    expect(isAllowedExternalNavigation('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalNavigation('file:///etc/passwd')).toBe(false);
    expect(isAllowedExternalNavigation('https://user:secret@example.com/')).toBe(false);
  });
});
