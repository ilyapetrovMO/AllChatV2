import {AudioGate} from '../src/media/AudioGate';

describe('AudioGate', () => {
  it('holds speech open, closes steady noise, and uses hysteresis to avoid chatter', () => {
    const gate = new AudioGate(-50);
    expect(gate.observe(-40, 0)).toBe(true);
    expect(gate.observe(-60, 100)).toBe(true);
    expect(gate.observe(-60, 251)).toBe(false);
    expect(gate.observe(-53, 300)).toBe(false);
    expect(gate.observe(-49, 350)).toBe(true);
  });
});
