import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {ParticipantVolumeModal, participantVolumeFromPosition} from '../src/screens/CommunityScreen';

describe('participant volume slider', () => {
  it('maps touch position to a clamped five-percent volume step', () => {
    expect(participantVolumeFromPosition(0, 200)).toBe(0);
    expect(participantVolumeFromPosition(93, 200)).toBe(0.45);
    expect(participantVolumeFromPosition(250, 200)).toBe(1);
  });

  it('previews drag movement locally and persists only once when released', () => {
    const onPreview = jest.fn();
    const onChange = jest.fn();
    let tree: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(React.createElement(ParticipantVolumeModal, {label:'Alex',onChange,onClose:jest.fn(),onPreview,open:true,palette:{field:'#111',text:'#fff',muted:'#aaa',border:'#333',accent:'#55f'} as never,value:1})); });
    const slider = tree!.root.findByProps({accessibilityLabel: 'Alex volume'});
    act(() => slider.props.onLayout({nativeEvent:{layout:{width:200}}}));
    act(() => slider.props.onResponderGrant({nativeEvent:{locationX:40}}));
    act(() => slider.props.onResponderMove({nativeEvent:{locationX:80}}));
    act(() => slider.props.onResponderMove({nativeEvent:{locationX:120}}));

    expect(onPreview.mock.calls.map(([value]) => value)).toEqual([0.2, 0.4, 0.6]);
    expect(onChange).not.toHaveBeenCalled();
    act(() => slider.props.onResponderRelease());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(0.6);
  });
});
