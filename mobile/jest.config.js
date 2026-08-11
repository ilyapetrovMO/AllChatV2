module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/node_modules/@react-native-documents/picker/jest/build/jest/setup.js'],
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-documents/picker)/)'],
};
