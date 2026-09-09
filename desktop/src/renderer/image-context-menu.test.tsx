import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageContextMenu } from './image-context-menu';

describe('Image context menu', () => {
  it('shows metadata and dispatches copy and download separately', async () => {
    const onCopy=vi.fn(async()=>{}),onDownload=vi.fn(async()=>{}),onClose=vi.fn();
    render(<ImageContextMenu name="photo.jpg" size="347.5 KB" x={20} y={20} onCopy={onCopy} onDownload={onDownload} onClose={onClose} />);
    expect(screen.getByText('photo.jpg')).toBeVisible();
    expect(screen.getByText('347.5 KB')).toBeVisible();
    expect(screen.getByRole('menuitem',{name:'Copy image'})).toHaveFocus();
    fireEvent.keyDown(document.activeElement!,{key:'ArrowDown'});
    expect(screen.getByRole('menuitem',{name:'Download'})).toHaveFocus();
    fireEvent.click(screen.getByRole('menuitem',{name:'Download'}));
    await waitFor(()=>expect(onClose).toHaveBeenCalledOnce());
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onCopy).not.toHaveBeenCalled();
  });
  it('retains a failed action for retry and captures Escape before the viewer', async () => {
    const onCopy=vi.fn().mockRejectedValueOnce(new Error('Denied')).mockResolvedValue(undefined),onClose=vi.fn(),viewerEscape=vi.fn();
    document.addEventListener('keydown',viewerEscape);
    try {
      render(<ImageContextMenu name="photo.png" size="32 KB" x={99999} y={99999} onCopy={onCopy} onDownload={vi.fn()} onClose={onClose} />);
      fireEvent.click(screen.getByRole('menuitem',{name:'Copy image'}));
      expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.keyDown(document,{key:'Escape'});
      expect(onClose).toHaveBeenCalledOnce();
      expect(viewerEscape).not.toHaveBeenCalled();
    } finally { document.removeEventListener('keydown',viewerEscape); }
  });
});
