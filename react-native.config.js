// iOS uses the custom C-ABI bridge and an isolated dynamic Vosk framework.
// Linking the original static Vosk pod beside Sherpa merges their OpenFST flags.
// Android retains the existing Expo module and pinned Maven implementation.
module.exports = {
  dependencies: {
    'react-native-vosk': { platforms: { android: null, ios: null } },
  },
};
