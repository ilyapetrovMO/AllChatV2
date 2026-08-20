import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(process.cwd(), 'src/renderer/styles.css'), 'utf8');

describe('desktop shared control styling', () => {
  it('gives the composer status strip an opaque background', () => {
    expect(css).toMatch(/\.message-composer-wrap\s*\{[^}]*background:\s*#222329/s);
  });

  it('styles generic form controls including checkboxes and file inputs', () => {
    expect(css).toContain('input:not([type="checkbox"]):not([type="radio"]):not([type="file"])');
    expect(css).toContain('input[type="checkbox"]');
    expect(css).toContain('::file-selector-button');
  });
});
