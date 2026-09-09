import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageAttachments } from './app';
import type { Attachment } from '../shared/instance-state';

const picture = (id: string): Attachment => ({ id, name: `${id}.png`, content_type: 'image/png', size: 4096, url: `/${id}`, preview_url: `/${id}/preview` });
beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());
const asset = () => Promise.resolve({ type: 'asset' as const, contentType: 'image/png', data: new Uint8Array([1]) });

describe('Inline message images', () => {
  it('opens the original without displaying attachment card metadata', async () => {
    const onAction = vi.fn(asset);
    const { container } = render(<MessageAttachments attachments={[picture('trail')]} onAction={onAction} />);
    const button = await screen.findByRole('button', { name: 'View trail.png at full size' });
    await act(async () => { fireEvent.click(button); });
    expect(await screen.findByRole('dialog', { name: 'Image viewer: trail.png' })).toBeInTheDocument();
    expect(onAction).toHaveBeenLastCalledWith({ type: 'load_asset', path: '/trail' });
    expect(container.querySelector('figure')).toBeNull();
    expect(screen.queryByText('trail.png')).not.toBeInTheDocument();
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('groups multiple images and retains download metadata for other files', async () => {
    const { container } = render(<MessageAttachments attachments={[picture('one'), picture('two'), { id: 'file', name: 'notes.txt', content_type: 'text/plain', size: 32, url: '/notes' }]} onAction={asset} />);
    expect(await screen.findAllByRole('img')).toHaveLength(2);
    expect(container.querySelector('.image-gallery')).not.toBeNull();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Download' })).toHaveAttribute('download', 'notes.txt');
  });
  it('shows a useful state when an image cannot be loaded', async () => {
    render(<MessageAttachments attachments={[picture('missing')]} onAction={() => Promise.reject(new Error('Unavailable'))} />);
    expect(await screen.findByText('Image unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
