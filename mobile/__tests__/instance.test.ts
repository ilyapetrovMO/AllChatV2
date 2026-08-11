import {normalizeInstanceURL} from '../src/domain/instance';

describe('normalizeInstanceURL', () => {
  it('defaults a hostname to HTTPS', () => {
    expect(normalizeInstanceURL('chat.example.test')).toBe('https://chat.example.test');
  });

  it('rejects cleartext production Instances', () => {
    expect(() => normalizeInstanceURL('http://chat.example.test')).toThrow('Instances must use HTTPS.');
  });

  it('allows an emulator development address only when requested', () => {
    expect(normalizeInstanceURL('http://10.0.2.2:8080', true)).toBe('http://10.0.2.2:8080');
    expect(() => normalizeInstanceURL('http://10.0.2.2:8080')).toThrow('Instances must use HTTPS.');
  });

  it('rejects embedded credentials and query parameters', () => {
    expect(() => normalizeInstanceURL('https://member@example.test')).toThrow();
    expect(() => normalizeInstanceURL('https://example.test?token=secret')).toThrow();
  });
});
