// Execute through Penpot execute_code after reconnecting the existing desktop file.
// Prepared from the captured Electron state; not executed or visually verified yet.
if (penpot.currentFile.id !== 'c828d3cf-7d4e-8145-8008-9a4f1a6ff37f' ||
    penpot.currentPage.id !== '6bdc1c40-ce96-804f-8008-9a5f830fd73b') {
  throw Error('The existing AllChat Desktop page is required');
}
const name = 'Desktop / Recovery / recovery-success-sign-in';
const existing = penpot.currentPage.root.children.find(s => s.name === name);
if (existing) return {boardId: existing.id, status: existing.getPluginData('status')};
const base = penpotUtils.findShapeById('6bdc1c40-ce96-804f-8008-9a6463e2cada');
if (!base || base.flex || base.grid) throw Error('Expected manually positioned sign-in baseline');
const card = penpotUtils.findShape(s => s.name === 'Authentication card', base);
const controls = penpotUtils.findShapes(s => s.type === 'board' &&
  ['Username input', 'Password input', 'Sign in submit',
   'Authentication tab / Sign in', 'Authentication tab / Register',
   'Authentication tab / Recovery'].includes(s.name), base);
const font = penpot.fonts.findAllByName('Inter').find(f => f.name === 'Inter');
if (!card || controls.length !== 6 || !font) throw Error('Baseline controls, card or font missing');
if (controls.some(s => s.parent.id !== base.id)) throw Error('Baseline hierarchy changed; inspect before moving controls');
const b = base.clone();
b.name = name;
b.x = 18800;
b.y = 3600;
const c = penpotUtils.findShape(s => s.name === 'Authentication card', b);
const dy = 64.08 - (c.y - b.y);
// Move top-level auth content once, preserving component descendants and the shell.
for (const s of b.children.filter(s =>
  (s.type === 'text' && s.x - b.x > 400) || controls.some(control => control.name === s.name))) {
  s.y += dy;
}
c.y = b.y + 64.08;
c.resize(480, 619.84);
for (const [copy, y] of [
  ['Password replaced. Sign in with your new', 563.73],
  ['password.', 589.33],
]) {
  const t = penpot.createText(copy);
  font.applyToText(t, font.variants.find(v => v.fontWeight === '400' && v.fontStyle === 'normal'));
  t.fontSize = '16';
  t.resize(384, 23);
  t.align = 'center';
  t.fills = [{fillColor: '#A4A8B3', fillOpacity: 1}];
  t.name = 'Recovery success confirmation';
  b.appendChild(t);
  t.x = b.x + 484;
  t.y = b.y + y;
}
b.setPluginData('capture', 'design/penpot/populated/desktop-recovery-reference/recovery-success-sign-in.png');
b.setPluginData('source-map', 'desktop/src/renderer/app.tsx:129 recover; :368 authentication form');
b.setPluginData('status', 'Editable reconstruction; rendering, component text overrides, typography and persisted export verification pending');
return {boardId: b.id, status: b.getPluginData('status')};
