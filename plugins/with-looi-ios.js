const { withInfoPlist, withAppDelegate, withPodfile, withPodfileProperties, withDangerousMod } = require('expo/config-plugins');
const { stageIosVoskModels } = require('../scripts/stage-ios-vosk-models.cjs');
const { stageIosVoskFramework } = require('../scripts/stage-ios-vosk-framework.cjs');
const { transformAppDelegate, applySingleSceneManifest } = require('./ios-scene-lifecycle.cjs');

function ensureMinimumPodDeploymentTarget(contents) {
  const marker = '# My LOOI: align pod targets with the application deployment floor';
  if (contents.includes(marker)) return contents;
  const anchor = /react_native_post_install\([\s\S]*?\n    \)/;
  if (!anchor.test(contents)) throw new Error('Could not locate React Native post_install in the iOS Podfile');
  return contents.replace(anchor, (match) => `${match}
    ${marker}
    minimum_ios = Gem::Version.new(podfile_properties['ios.deploymentTarget'] || '16.4')
    installer.pods_project.targets.each do |pod_target|
      pod_target.build_configurations.each do |build_config|
        current = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current.nil? || (current.match?(/\\A\\d+(?:\\.\\d+)*\\z/) && Gem::Version.new(current) < minimum_ios)
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios.to_s
        end
      end
    end`);
}

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
    applySingleSceneManifest(plist);
    plist.NSAppTransportSecurity = {
      ...(plist.NSAppTransportSecurity || {}),
      NSAllowsArbitraryLoads: false,
      NSAllowsLocalNetworking: true,
    };
    return result;
  });
  config = withAppDelegate(config, (result) => {
    if (result.modResults.language !== 'swift') {
      throw new Error('My LOOI scene lifecycle requires the pinned Swift Expo AppDelegate template');
    }
    result.modResults.contents = transformAppDelegate(result.modResults.contents);
    return result;
  });
  config = withPodfile(config, (result) => {
    result.modResults.contents = ensureMinimumPodDeploymentTarget(result.modResults.contents);
    return result;
  });
  return withDangerousMod(config, ['ios', async (result) => {
    stageIosVoskModels(result.modRequest.projectRoot);
    await stageIosVoskFramework(result.modRequest.projectRoot);
    return result;
  }]);
};

module.exports.ensureMinimumPodDeploymentTarget = ensureMinimumPodDeploymentTarget;
