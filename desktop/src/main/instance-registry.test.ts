import { describe, expect, it } from 'vitest';

import { InstanceRegistry } from './instance-registry';
import { SQLiteInstanceProfileStore } from './instance-profile-store';

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

  it('infers HTTPS when an Instance is added using only its hostname', () => {
    const registry = new InstanceRegistry(() => 'instance-bare-host');

    const profile = registry.add({ displayName: '', baseUrl: 'ru.elitedarklord.com' });

    expect(profile.displayName).toBe('ru.elitedarklord.com');
    expect(profile.baseUrl).toBe('https://ru.elitedarklord.com');
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

  it('restores isolated Instance Profiles and the active selection from SQLite', () => {
    const store = new SQLiteInstanceProfileStore(':memory:');
    const ids = ['instance-one', 'instance-two'];
    const registry = new InstanceRegistry(() => ids.shift()!, store);
    registry.add({ displayName: 'Home', baseUrl: 'https://home.example' });
    const work = registry.add({ displayName: 'Work', baseUrl: 'https://work.example' });
    registry.select(work.id);

    const restored = new InstanceRegistry(undefined, store);

    expect(restored.state()).toEqual(registry.state());
    expect(new Set(restored.list().map(({ partition }) => partition)).size).toBe(2);
  });
});
// @vitest-environment node
