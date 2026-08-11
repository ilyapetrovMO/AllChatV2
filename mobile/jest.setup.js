/* global jest */
jest.mock('react-native-webrtc', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    mediaDevices: {},
    MediaStream: class {},
    RTCPeerConnection: class {},
    RTCSessionDescription: class { constructor(value) { return value; } },
    RTCView: props => React.createElement(View, props),
  };
});
