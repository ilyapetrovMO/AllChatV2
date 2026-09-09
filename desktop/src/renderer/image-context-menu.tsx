import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export async function copyImage(blob: Blob): Promise<void> {
  // Clipboard images use PNG regardless of the attachment's source format.
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion unavailable');
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image conversion failed')), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } finally { URL.revokeObjectURL(url); }
}

export function ImageContextMenu({ name, size, x, y, onCopy, onDownload, onClose }: {
  name: string; size: string; x: number; y: number;
  onCopy(): Promise<void>; onDownload(): Promise<void>; onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  useLayoutEffect(() => {
    const menu = ref.current!;
    const fit = () => {
      menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
    };
    fit();
    menu.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) onClose(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        event.stopImmediatePropagation(); onClose();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard, true);
    window.addEventListener('resize', fit);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard, true); window.removeEventListener('resize', fit); };
  }, [x, y, onClose, error]);
  async function act(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await action(); onClose(); } catch (cause) {
      const detail = `${action === onCopy ? 'copy' : 'download'}: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : 'Unknown failure'}`.replace(/(?:https?:\/\/|blob:|data:)[^\s]+/g, '[asset]').slice(0, 500);
      console.error('[AllChat image action]', detail);
      window.allchatDesktop?.reportDiagnostic?.('image_action_failed', detail);
      setError('Couldn’t complete action. Try again.');
    }
    finally { pending.current = false; setBusy(false); }
  }
  return createPortal(<div ref={ref} className="image-context-menu" role="menu" aria-label="Image actions" style={{left:x,top:y}}
    onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }}>
    <div className="image-menu-metadata"><strong title={name}>{name}</strong><small>{size}</small></div>
    <button type="button" role="menuitem" disabled={busy} onClick={() => void act(onCopy)}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H3V3h12v2"/></svg>Copy image</button>
    <button type="button" role="menuitem" disabled={busy} onClick={() => void act(onDownload)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>Download</button>
    {busy && <small role="status">Working…</small>}{error && <small role="alert">{error}</small>}
  </div>, document.body);
}
