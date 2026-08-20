import { describe, expect, it } from 'vitest';
import { assertAllowedAssetPath } from './asset-policy';

describe('desktop authenticated asset policy', () => {
  it('allows the canonical Community avatar with a cache-busting query', () => {
    expect(() => assertAllowedAssetPath('/api/v1/community-avatar?v=42')).not.toThrow();
  });

  it('still rejects unrelated and cross-origin asset paths', () => {
    expect(() => assertAllowedAssetPath('/api/v1/admin/settings')).toThrow('Asset path is invalid');
    expect(() => assertAllowedAssetPath('https://example.test/api/v1/community-avatar')).toThrow('Asset path is invalid');
  });
});
