import { describe, expect, it } from 'vitest';

import { InstanceRegistry } from './instance-registry';

describe('InstanceRegistry', () => {
  it('normalizes addresses and gives each Instance a distinct partition', () => {
    const registry = new InstanceRegistry(() => 'instance-one');
    const profile = registry.add({ displayName: 'Home', baseUrl: 'https://chat.example/' });

    expect(profile).toEqual({
      id: 'instance-one',
      displayName: 'Home',
      baseUrl: 'https://chat.example',
      partition: 'persist:allchat-instance-one',
      credentialRef: null,
    });
  });

  it('never accepts or returns a raw credential', () => {
    const registry = new InstanceRegistry(() => 'instance-two');

    expect(() =>
      registry.add({
        displayName: 'Work',
        baseUrl: 'https://work.example',
        token: 'must-not-be-stored',
      } as never),
    ).toThrow(/credential/i);
    expect(JSON.stringify(registry.list())).not.toContain('must-not-be-stored');
  });
});
