import { describe, expect, it } from 'vitest';
import { normalizeInstanceUrl } from './instance-url';

describe('Instance URL normalization', () => {
  it('infers HTTPS for a bare Community hostname', () => {
    expect(normalizeInstanceUrl('ru.elitedarklord.com')).toBe('https://ru.elitedarklord.com');
  });

  it('preserves explicit HTTPS and local-development HTTP', () => {
    expect(normalizeInstanceUrl('https://chat.example/')).toBe('https://chat.example');
    expect(normalizeInstanceUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
  });

  it('rejects insecure remote addresses', () => {
    expect(() => normalizeInstanceUrl('http://chat.example')).toThrow('must use HTTPS');
  });
});
