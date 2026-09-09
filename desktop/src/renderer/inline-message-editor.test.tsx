import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineMessageEditor } from './inline-message-editor';

describe('Inline message editing', () => {
  it('focuses existing text, saves with Enter, and leaves Shift+Enter and IME Enter alone', async () => {
    const onSave = vi.fn(async () => true), onClose = vi.fn();
    render(<InlineMessageEditor body="Original" onSave={onSave} onClose={onClose} />);
    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(8);
    fireEvent.change(field, { target: { value: 'Changed\ntext' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith('Changed\ntext');
  });
  it('keeps failed edits for retry and prevents duplicate saves', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(true), onClose = vi.fn();
    render(<InlineMessageEditor body="Original" onSave={onSave} onClose={onClose} />);
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Keep this' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save');
    expect(field).toHaveValue('Keep this');
    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
  it('cancels without saving and blocks media input', () => {
    const onSave = vi.fn(), onClose = vi.fn();
    const { container } = render(<InlineMessageEditor body="Original" onSave={onSave} onClose={onClose} />);
    const field = screen.getByRole('textbox');
    expect(container.querySelector('input[type=file]')).toBeNull();
    expect(fireEvent.paste(field, { clipboardData: { items: [{ kind: 'file' }] } })).toBe(false);
    expect(fireEvent.drop(field, { dataTransfer: { files: [new File(['image'], 'photo.png')] } })).toBe(false);
    fireEvent.change(field, { target: { value: ' ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
