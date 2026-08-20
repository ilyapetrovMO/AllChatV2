import {participantVolumeFromPosition} from '../src/screens/CommunityScreen';

describe('participant volume slider', () => {
  it('maps touch position to a clamped five-percent volume step', () => {
    expect(participantVolumeFromPosition(0, 200)).toBe(0);
    expect(participantVolumeFromPosition(93, 200)).toBe(0.45);
    expect(participantVolumeFromPosition(250, 200)).toBe(1);
  });
});
