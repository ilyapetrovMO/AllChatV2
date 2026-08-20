import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const RELEASE_API = 'https://api.github.com/repos/ilyapetrovMO/AllChatV2/releases/latest';

interface ReleaseAsset { name: string; browser_download_url: string }
interface GitHubRelease { tag_name: string; html_url: string; assets: ReleaseAsset[] }

export interface DesktopUpdate {
  version: string;
  pageUrl: string;
  asset: ReleaseAsset;
  checksums: ReleaseAsset;
}

export function compareVersions(left: string, right: string): number {
  const normalize = (value: string) => value.replace(/^v/, '').split('-')[0].split('.').map((part) => Number(part));
  const a = normalize(left), b = normalize(right);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) throw new Error('Invalid release version.');
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function desktopAssetName(version: string, platform: NodeJS.Platform, arch: string): string | null {
  const release = version.replace(/^v/, '');
  if (platform === 'win32' && arch === 'x64') return `AllChat-desktop-${release}-windows-x64.msi`;
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) return `AllChat-desktop-${release}-macos-${arch}.zip`;
  if (platform === 'linux' && arch === 'x64') return `AllChat-desktop-${release}-linux-x64.zip`;
  return null;
}

export async function findDesktopUpdate(
  currentVersion: string,
  platform: NodeJS.Platform,
  arch: string,
  request: typeof fetch = fetch,
): Promise<DesktopUpdate | null> {
  const response = await request(RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `AllChat-Desktop/${currentVersion}` } });
  if (!response.ok) throw new Error(`Release check returned HTTP ${response.status}.`);
  const release = await response.json() as GitHubRelease;
  if (!release?.tag_name || compareVersions(release.tag_name, currentVersion) <= 0) return null;
  const expectedName = desktopAssetName(release.tag_name, platform, arch);
  if (!expectedName) return null;
  const asset = release.assets?.find((candidate) => candidate.name === expectedName);
  const checksums = release.assets?.find((candidate) => candidate.name === 'SHA256SUMS');
  if (!asset || !checksums) throw new Error(`Release ${release.tag_name} is missing its desktop package or checksums.`);
  assertGitHubDownload(asset.browser_download_url);
  assertGitHubDownload(checksums.browser_download_url);
  return { version: release.tag_name.replace(/^v/, ''), pageUrl: release.html_url, asset, checksums };
}

export async function downloadVerifiedUpdate(
  update: DesktopUpdate,
  directory: string,
  request: typeof fetch = fetch,
): Promise<string> {
  const checksumsResponse = await request(update.checksums.browser_download_url);
  if (!checksumsResponse.ok) throw new Error(`Checksum download returned HTTP ${checksumsResponse.status}.`);
  const expected = checksumFor(await checksumsResponse.text(), update.asset.name);
  if (!expected) throw new Error(`No checksum was published for ${update.asset.name}.`);

  const response = await request(update.asset.browser_download_url);
  if (!response.ok || !response.body) throw new Error(`Update download returned HTTP ${response.status}.`);
  const destination = availableDestination(directory, update.asset.name);
  const temporary = `${destination}.part`;
  const hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } });
  try {
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), meter, createWriteStream(temporary, { flags: 'wx' }));
    const actual = hash.digest('hex');
    if (actual !== expected) throw new Error('Downloaded update failed SHA-256 verification.');
    await rename(temporary, destination);
    return destination;
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function checksumFor(manifest: string, filename: string): string | null {
  for (const line of manifest.split(/\r?\n/)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match && match[2] === filename) return match[1].toLowerCase();
  }
  return null;
}

function availableDestination(directory: string, filename: string): string {
  const parsed = path.parse(filename);
  let candidate = path.join(directory, filename);
  for (let suffix = 1; existsSync(candidate) || existsSync(`${candidate}.part`); suffix += 1) {
    candidate = path.join(directory, `${parsed.name}-${suffix}${parsed.ext}`);
  }
  return candidate;
}

function assertGitHubDownload(value: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') throw new Error('Release contains an untrusted download URL.');
}
