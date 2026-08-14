import {isNewerVersion} from '../src/updates/AppUpdater';

describe('app update versions', () => {
  it('only accepts a strictly newer semantic server release', () => {
    expect(isNewerVersion('v1.3.0', '1.2.9')).toBe(true);
    expect(isNewerVersion('v2.0.0', '1.99.99')).toBe(true);
    expect(isNewerVersion('v1.2.3', '1.2.3')).toBe(false);
    expect(isNewerVersion('v1.2.2', '1.2.3')).toBe(false);
    expect(isNewerVersion('dev', '1.2.3')).toBe(false);
  });
});
