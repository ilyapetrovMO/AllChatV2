import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { compareVersions, desktopAssetName, downloadVerifiedUpdate, findDesktopUpdate } from './desktop-updater';

describe('desktop updater', () => {
  it('compares release versions numerically', () => {
    expect(compareVersions('v0.1.58', '0.1.57')).toBe(1);
    expect(compareVersions('0.1.58', '0.1.58')).toBe(0);
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1);
  });

  it('selects only a package supported by the current platform', () => {
    expect(desktopAssetName('v0.1.58', 'win32', 'x64')).toBe('AllChat-desktop-0.1.58-windows-x64.msi');
    expect(desktopAssetName('v0.1.58', 'darwin', 'arm64')).toBe('AllChat-desktop-0.1.58-macos-arm64.zip');
    expect(desktopAssetName('v0.1.58', 'linux', 'x64')).toBe('AllChat-desktop-0.1.58-linux-x64.zip');
    expect(desktopAssetName('v0.1.58', 'linux', 'arm64')).toBeNull();
  });

  it('finds a newer matching GitHub release', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v0.1.59', html_url: 'https://github.com/ilyapetrovMO/AllChatV2/releases/tag/v0.1.59', assets: [
        { name: 'AllChat-desktop-0.1.59-linux-x64.zip', browser_download_url: 'https://github.com/ilyapetrovMO/AllChatV2/releases/download/v0.1.59/desktop.zip' },
        { name: 'SHA256SUMS', browser_download_url: 'https://github.com/ilyapetrovMO/AllChatV2/releases/download/v0.1.59/SHA256SUMS' },
      ],
    }), { status: 200 })) as typeof fetch;
    await expect(findDesktopUpdate('0.1.58', 'linux', 'x64', request)).resolves.toMatchObject({ version: '0.1.59' });
  });

  it('downloads only when the package checksum matches', async () => {
    const bytes = Buffer.from('verified desktop package');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const request = vi.fn(async (input: string | URL | Request) => String(input).endsWith('SHA256SUMS')
      ? new Response(`${digest}  AllChat-desktop-0.1.59-linux-x64.zip\n`)
      : new Response(bytes)) as typeof fetch;
    const directory = await mkdtemp(path.join(os.tmpdir(), 'allchat-update-test-'));
    const progress = vi.fn();
    const destination = await downloadVerifiedUpdate({
      version: '0.1.59', pageUrl: '',
      asset: { name: 'AllChat-desktop-0.1.59-linux-x64.zip', browser_download_url: 'https://github.com/package' },
      checksums: { name: 'SHA256SUMS', browser_download_url: 'https://github.com/SHA256SUMS' },
    }, directory, request, progress);
    expect(await readFile(destination)).toEqual(bytes);
    expect(progress).toHaveBeenLastCalledWith({ receivedBytes: bytes.length, totalBytes: null });
  });

  it('rejects a corrupted package', async () => {
    const request = vi.fn(async (input: string | URL | Request) => String(input).endsWith('SHA256SUMS')
      ? new Response(`${'0'.repeat(64)}  update.zip\n`)
      : new Response('corrupt')) as typeof fetch;
    const directory = await mkdtemp(path.join(os.tmpdir(), 'allchat-update-test-'));
    await expect(downloadVerifiedUpdate({ version: '2', pageUrl: '', asset: { name: 'update.zip', browser_download_url: 'https://github.com/update' }, checksums: { name: 'SHA256SUMS', browser_download_url: 'https://github.com/SHA256SUMS' } }, directory, request)).rejects.toThrow('SHA-256');
  });
});
