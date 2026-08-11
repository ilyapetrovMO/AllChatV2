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
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {requestPermission: jest.fn(), createChannel: jest.fn(), displayNotification: jest.fn()},
  AndroidImportance: {HIGH: 4}, AuthorizationStatus: {DENIED: 0},
}));
