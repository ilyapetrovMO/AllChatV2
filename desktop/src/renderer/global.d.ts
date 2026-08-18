import type { DesktopBridge } from '../shared/desktop-bridge';

declare global {
  interface Window {
    allchatDesktop: DesktopBridge;
  }
}

export {};
