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

  it('keeps Member actions in a polished popover menu instead of loose wrapping buttons', () => {
    expect(css).toMatch(/\.member-card-actions\s*\{[^}]*display:\s*grid;[^}]*width:\s*188px/s);
    expect(css).toMatch(/\.member-card-actions\[hidden\]\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/\.member-card \.member-card-actions button\s*\{[^}]*width:\s*100%[^}]*text-align:\s*left/s);
  });

  it('keeps image viewer controls below the custom titlebar and above the app shell', () => {
    expect(css).toMatch(/\.image-lightbox\s*\{[^}]*z-index:\s*2100;[^}]*inset:\s*28px 0 0/s);
    expect(css).toMatch(/\.image-lightbox-close\s*\{[^}]*position:\s*absolute/s);
  });

  it('styles generic form controls including checkboxes and file inputs', () => {
    expect(css).toContain(':where(input:not([type="checkbox"]):not([type="radio"]):not([type="file"])');
    expect(css).toContain('input[type="checkbox"]');
    expect(css).toContain('::file-selector-button');
  });

  it('lets the global Search icon reserve space before its text', () => {
    expect(css).toMatch(/\.header-search input\s*\{[^}]*padding-left:\s*34px;[^}]*line-height:\s*20px/s);
    expect(css).toMatch(/\.header-search > \.lucide-icon\s*\{[^}]*top:\s*calc\(50% - 1px\);[^}]*width:\s*18px;[^}]*height:\s*18px/s);
    expect(css.indexOf('.header-search input { padding-left: 34px;')).toBeGreaterThan(css.indexOf(':where(input:not('));
  });

  it('does not inset Community avatars with native button padding', () => {
    expect(css).toMatch(/\.brand-mark, \.instance-button\s*\{[^}]*padding:\s*0/s);
  });

  it('uses larger circles and a phone-shaped mobile Presence indicator', () => {
    expect(css).toMatch(/\.presence-dot\s*\{[^}]*width:\s*14px[^}]*height:\s*14px/s);
    expect(css).toMatch(/\.presence-dot\.mobile\s*\{[^}]*width:\s*10px[^}]*height:\s*16px[^}]*border-radius:\s*3px/s);
    expect(css).toContain('.presence-dot.mobile::after');
  });

  it('keeps voice and Member controls visible throughout Community settings', () => {
    expect(css).not.toContain('.member-settings-open .member-panel');
    expect(css).not.toContain('.community-settings-open .conversation-sidebar > *');
    expect(css).toMatch(/\.community-settings-open \.community-administration > nav\s*\{[^}]*bottom:\s*52px/s);
    expect(css).toMatch(/\.community-settings-open:has\(#desktop-call-controls:not\(:empty\)\) \.community-administration > nav\s*\{[^}]*bottom:\s*104px/s);
  });
});
