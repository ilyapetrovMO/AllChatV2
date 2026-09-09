import { useLayoutEffect, useRef, useState } from 'react';

export function InlineMessageEditor({ body, onSave, onClose }: {
  body: string;
  onSave(body: string): Promise<boolean>;
  onClose(): void;
}) {
  const [value, setValue] = useState(body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    const field = input.current!;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    field.closest('.message')?.scrollIntoView?.({ block: 'center' });
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    const field = input.current!;
    field.style.height = '0px';
    field.style.height = `${Math.min(240, Math.max(56, field.scrollHeight))}px`;
  }, [value]);
  async function save() {
    if (pending.current || !value.trim()) return;
    if (value === body) { onClose(); return; }
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const saved = await onSave(value);
      if (!mounted.current) return;
      if (saved) onClose();
      else setError('Couldn’t save. Try again.');
    } catch { setError('Couldn’t save. Try again.'); }
    finally { pending.current = false; setSaving(false); }
  }
  return <form className="inline-message-editor" aria-label="Edit message" onSubmit={event => { event.preventDefault(); void save(); }} onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()}>
    <textarea ref={input} aria-label="Edit message text" value={value} readOnly={saving} aria-busy={saving}
      onChange={event => { setValue(event.target.value); setError(''); }}
      onPaste={event => { if ([...event.clipboardData.items].some(item => item.kind === 'file')) event.preventDefault(); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); if (!pending.current) onClose(); }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void save(); }
      }} />
    <div className="inline-edit-shortcuts">Escape to <button type="button" disabled={saving} onClick={onClose}>cancel</button><span> · Enter to </span><button type="submit" disabled={saving || !value.trim()}>save</button><span> · Shift+Enter for a new line</span>{saving && <span role="status"> · Saving…</span>}</div>
    {error && <div className="inline-edit-error" role="alert">{error}</div>}
  </form>;
}
