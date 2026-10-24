const { withInfoPlist, withPodfileProperties, withDangerousMod } = require('expo/config-plugins');
const { stageIosVoskModels } = require('../scripts/stage-ios-vosk-models.cjs');

module.exports = function withLooiIos(config) {
  config = withPodfileProperties(config, (result) => {
    result.modResults['ios.deploymentTarget'] = '16.4';
    return result;
  });
  config = withInfoPlist(config, (result) => {
    const plist = result.modResults;
    plist.NSCameraUsageDescription = 'Allow My LOOI to see a scene you explicitly ask it to look at and optionally detect faces on-device.';
    plist.NSMicrophoneUsageDescription = 'Allow My LOOI to hear wake phrases, safety commands and your conversations.';
    plist.NSBluetoothAlwaysUsageDescription = 'Allow My LOOI to connect to your LOOI robot.';
    plist.LSSupportsOpeningDocumentsInPlace = true;
    // This application's privacy contract is foreground-only audio and BLE.
    plist.UIBackgroundModes = (plist.UIBackgroundModes || []).filter((mode) => !['audio', 'bluetooth-central', 'voip'].includes(mode));
    plist.UIRequiredDeviceCapabilities = ['arm64'];
    plist.NSAppTransportSecurity = {
      ...(plist.NSAppTransportSecurity || {}),
      NSAllowsArbitraryLoads: false,
      NSAllowsLocalNetworking: true,
    };
    return result;
  });
  return withDangerousMod(config, ['ios', async (result) => {
    stageIosVoskModels(result.modRequest.projectRoot);
    return result;
  }]);
};
