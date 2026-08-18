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

  it('keeps the main-process action validator synchronized with the shared action contract', () => {
    const contract = readFileSync(path.join(process.cwd(), 'src/shared/instance-actions.ts'), 'utf8');
    const main = readFileSync(path.join(process.cwd(), 'src/main/main.ts'), 'utf8');
    const actionBlock = contract.slice(contract.indexOf('export type InstanceAction ='), contract.indexOf('export type MessagePage'));
    const actionTypes = [...actionBlock.matchAll(/type: '([^']+)'/g)].map((match) => match[1]);
    const validator = main.slice(main.indexOf('function assertInstanceAction'), main.indexOf('function assertBoundedText'));

    expect(actionTypes.length).toBeGreaterThan(0);
    expect(actionTypes.filter((type) => !validator.includes(`'${type}'`))).toEqual([]);
  });
});
