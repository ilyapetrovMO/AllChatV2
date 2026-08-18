import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Electron main module format', () => {
  it('does not classify Forge CommonJS output as an ES module', () => {
    const packagePath = path.join(process.cwd(), 'package.json');
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      main: string;
      type?: string;
    };

    expect({ main: manifest.main, type: manifest.type }).not.toEqual({
      main: '.vite/build/main.js',
      type: 'module',
    });
  });
});
