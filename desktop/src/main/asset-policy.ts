export function assertAllowedAssetPath(path: string): void {
  let asset: URL;
  try {
    asset = new URL(path, 'https://allchat.invalid');
  } catch {
    throw new Error('Asset path is invalid');
  }
  const previewImage = asset.pathname === '/api/v1/link-preview/image' && Boolean(asset.searchParams.get('url'));
  if (previewImage) {
    try {
      const target = new URL(asset.searchParams.get('url')!);
      if ((target.protocol !== 'https:' && target.protocol !== 'http:') || !target.hostname) throw new Error();
    } catch {
      throw new Error('Preview image URL is invalid');
    }
  }
  const allowed = asset.pathname.startsWith('/api/v1/attachments/') ||
    asset.pathname === '/api/v1/community-avatar' ||
    /^\/api\/v1\/members\/[^/]+\/(avatar|banner)$/.test(asset.pathname) ||
    previewImage;
  if (asset.origin !== 'https://allchat.invalid' || !allowed) throw new Error('Asset path is invalid');
}
