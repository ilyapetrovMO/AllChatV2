/* global jest */
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const {View} = require('react-native');
  const Icon = props => React.createElement(View, {...props, testID: props.testID || 'lucide-icon'});
  return new Proxy({}, {get: () => Icon});
});
jest.mock('react-native-webrtc', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    mediaDevices: {},
    MediaStream: class {},
    RTCPeerConnection: class {},
    RTCRtpSender: {getCapabilities: () => ({codecs: []})},
    RTCSessionDescription: class { constructor(value) { return value; } },
    RTCView: props => React.createElement(View, props),
  };
});
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {getNotificationSettings: jest.fn(), requestPermission: jest.fn(), createChannel: jest.fn(), displayNotification: jest.fn()},
  AndroidImportance: {HIGH: 4, LOW: 2}, AndroidCategory: {CALL: 'call'}, AndroidForegroundServiceType: {FOREGROUND_SERVICE_TYPE_MICROPHONE: 128, FOREGROUND_SERVICE_TYPE_CAMERA: 64, FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION: 32}, AuthorizationStatus: {DENIED: 0, AUTHORIZED: 1, NOT_DETERMINED: -1},
}));
