import type { MenuItemConstructorOptions } from 'electron';

export type TrayPresence = 'available' | 'dnd';

export function createTrayMenu(
  presence: TrayPresence,
  setPresence: (presence: TrayPresence) => void,
  show: () => void,
  quit: () => void,
): MenuItemConstructorOptions[] {
  return [
    { label: 'Show AllChat', click: show },
    { type: 'separator' },
    {
      label: 'Status',
      submenu: [
        { label: 'Online', type: 'radio', checked: presence === 'available', click: () => setPresence('available') },
        { label: 'Do Not Disturb', type: 'radio', checked: presence === 'dnd', click: () => setPresence('dnd') },
      ],
    },
    { type: 'separator' },
    { label: 'Quit AllChat', click: quit },
  ];
}

export function shouldHideOnClose(quitting: boolean): boolean {
  return !quitting;
}
