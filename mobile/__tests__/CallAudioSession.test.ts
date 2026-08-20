import {NativeModules} from 'react-native';

import {setCallMicrophoneMuted} from '../src/media/CallAudioSession';

describe('native Call audio session', () => {
  it('hardware-mutes and unmutes the Android microphone', () => {
    const setMicrophoneMute = jest.fn();
    NativeModules.InCallManager = {setMicrophoneMute};

    setCallMicrophoneMuted(true);
    setCallMicrophoneMuted(false);

    expect(setMicrophoneMute.mock.calls).toEqual([[true], [false]]);
  });
});
