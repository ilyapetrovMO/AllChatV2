import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(process.cwd(), 'src/renderer/styles.css'), 'utf8');

describe('desktop shared control styling', () => {
  it('gives the composer status strip an opaque background', () => {
    expect(css).toMatch(/\.message-composer-wrap\s*\{[^}]*background:\s*#222329/s);
  });

  it('renders attachment selection as a bare muted icon', () => {
    expect(css).toMatch(/\.attach-button\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--muted\)/s);
    expect(css).not.toContain('.message-composer > button[type="submit"]');
  });

  it('styles generic form controls including checkboxes and file inputs', () => {
    expect(css).toContain(':where(input:not([type="checkbox"]):not([type="radio"]):not([type="file"])');
    expect(css).toContain('input[type="checkbox"]');
    expect(css).toContain('::file-selector-button');
  });

  it('lets the global Search icon reserve space before its text', () => {
    expect(css).toMatch(/\.header-search input\s*\{[^}]*padding-left:\s*30px/s);
    expect(css.indexOf('.header-search input { padding-left: 30px;')).toBeGreaterThan(css.indexOf(':where(input:not('));
  });

  it('does not inset Community avatars with native button padding', () => {
    expect(css).toMatch(/\.brand-mark, \.instance-button\s*\{[^}]*padding:\s*0/s);
  });

  it('uses larger circles and a phone-shaped mobile Presence indicator', () => {
    expect(css).toMatch(/\.presence-dot\s*\{[^}]*width:\s*14px[^}]*height:\s*14px/s);
    expect(css).toMatch(/\.presence-dot\.mobile\s*\{[^}]*width:\s*10px[^}]*height:\s*16px[^}]*border-radius:\s*3px/s);
    expect(css).toContain('.presence-dot.mobile::after');
  });
});
