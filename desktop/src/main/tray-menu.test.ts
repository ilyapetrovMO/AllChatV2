import { describe, expect, it, vi } from 'vitest';

import { createTrayMenu, shouldHideOnClose } from './tray-menu';

describe('desktop tray behavior', () => {
  it('offers status, restore, and explicit quit actions', () => {
    const setPresence = vi.fn();
    const show = vi.fn();
    const quit = vi.fn();
    const menu = createTrayMenu('dnd', setPresence, show, quit);
    const status = menu.find((item) => item.label === 'Status');
    const submenu = status?.submenu as Electron.MenuItemConstructorOptions[];

    expect(menu.map((item) => item.label).filter(Boolean)).toEqual(['Show AllChat', 'Status', 'Quit AllChat']);
    expect(submenu.map((item) => [item.label, item.checked])).toEqual([['Online', false], ['Do Not Disturb', true]]);
    (submenu[0]?.click as () => void)();
    (menu[0]?.click as () => void)();
    (menu.at(-1)?.click as () => void)();
    expect(setPresence).toHaveBeenCalledWith('available');
    expect(show).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });

  it('hides ordinary closes but permits an explicit application quit', () => {
    expect(shouldHideOnClose(false)).toBe(true);
    expect(shouldHideOnClose(true)).toBe(false);
  });
});
