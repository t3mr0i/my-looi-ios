// iOS links the Vosk XCFramework through its pod. Android retains the existing
// Expo module and pinned Maven Vosk implementation.
module.exports = {
  dependencies: {
    'react-native-vosk': { platforms: { android: null } },
  },
};
