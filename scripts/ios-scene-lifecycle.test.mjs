import assert from "node:assert/strict";
import test from "node:test";
import sceneLifecycle from "../plugins/ios-scene-lifecycle.cjs";

// Snapshot of the generated Expo SDK 56 AppDelegate used by this project.
const generatedAppDelegate = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    // A plugin may inject setup statements here; the transform must leave them intact.
    configureAudioSession()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
`;

test("transforms the generated Expo SDK 56 AppDelegate to use one scene-owned window", () => {
  const result = sceneLifecycle.transformAppDelegate(generatedAppDelegate);
  assert.match(result, /var sceneLaunchOptions: \[UIApplication\.LaunchOptionsKey: Any\]\?/);
  assert.match(result, /var hasStartedReactNative = false/);
  assert.match(result, /sceneLaunchOptions = launchOptions/);
  assert.match(result, /if hasStartedReactNative \{\s+sceneDelegate\.window = window\s+return\s+\}/);
  assert.doesNotMatch(result, /window = UIWindow\(frame: UIScreen\.main\.bounds\)/);
  assert.match(result, /UIWindow\(windowScene: windowScene\)/);
  assert.match(result, /factory\.startReactNative\([\s\S]*?in: sceneWindow,[\s\S]*?launchOptions: options\)/);
  assert.match(result, /window = sceneWindow\s+sceneDelegate\.window = sceneWindow/);
  assert.match(result, /configureAudioSession\(\)/);
  assert.equal((result.match(/class SceneDelegate:/g) ?? []).length, 1);
});

test("transformation is idempotent", () => {
  const once = sceneLifecycle.transformAppDelegate(generatedAppDelegate);
  assert.equal(sceneLifecycle.transformAppDelegate(once), once);
});

test("scene URLs and activities use existing Expo and React Native handlers", () => {
  const result = sceneLifecycle.transformAppDelegate(generatedAppDelegate);
  assert.match(result, /connectionOptions\.urlContexts\.first[\s\S]*?options\[\.url\] = context\.url[\s\S]*?context\.options\.sourceApplication/);
  assert.match(result, /connectionOptions\.userActivities\.first[\s\S]*?options\[\.userActivityDictionary\] = activityOptions/);
  assert.match(result, /appDelegate\.application\([\s\S]*?open: context\.url,[\s\S]*?applicationOpenURLOptions\(from: context\.options\)\)/);
  assert.match(result, /var activityOptions: \[String: Any\]/);
  assert.match(result, /activityOptions\["UIApplicationLaunchOptionsUserActivityKey"\] = userActivity/);
  assert.match(result, /func applicationOpenURLOptions\(from sceneOptions: UIScene\.OpenURLOptions\) -> \[UIApplication\.OpenURLOptionsKey: Any\]/);
  assert.match(result, /\.openInPlace: sceneOptions\.openInPlace/);
  assert.match(result, /continue: userActivity,[\s\S]*?restorationHandler: \{ _ in \}\)/);
  assert.match(result, /let expoHandled = super\.application\(app, open: url, options: options\)\s+let reactNativeHandled = RCTLinkingManager\.application\(app, open: url, options: options\)\s+return expoHandled \|\| reactNativeHandled/);
  assert.match(result, /RCTLinkingManager\.application\(app, open: url, options: options\)/);
  assert.match(result, /RCTLinkingManager\.application\(application, continue: userActivity, restorationHandler: restorationHandler\)/);
});

test("scene transitions forward to Expo's legacy lifecycle subscribers", () => {
  const result = sceneLifecycle.transformAppDelegate(generatedAppDelegate);
  for (const callback of [
    "applicationWillResignActive",
    "applicationDidBecomeActive",
    "applicationWillEnterForeground",
    "applicationDidEnterBackground"
  ]) {
    assert.match(result, new RegExp(`\\?\\.${callback}\\(UIApplication\\.shared\\)`));
  }
  assert.doesNotMatch(result, /NotificationCenter\.default\.post/);
});

test("rejects an unexpected generated template instead of silently skipping scene startup", () => {
  assert.throws(
    () => sceneLifecycle.transformAppDelegate(generatedAppDelegate.replace("factory.startReactNative(", "factory.launchReactNative(")),
    /didFinishLaunching React Native startup call/
  );
  assert.throws(
    () => sceneLifecycle.transformAppDelegate(`${sceneLifecycle.APP_DELEGATE_MARKER}\nclass AppDelegate {}`),
    /partial LOOI iOS 27 scene lifecycle marker/
  );
});

test("sets exactly one application scene and preserves unrelated plist keys", () => {
  const plist = {
    CFBundleDisplayName: "My LOOI",
    UIApplicationSceneManifest: {
      UISceneConfigurations: { OtherRole: [{ UISceneConfigurationName: "External" }] }
    }
  };
  const updated = sceneLifecycle.applySingleSceneManifest(plist);
  const manifest = updated.UIApplicationSceneManifest;
  assert.equal(updated.CFBundleDisplayName, "My LOOI");
  assert.equal(manifest.UIApplicationSupportsMultipleScenes, false);
  assert.deepEqual(manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication, [{
    UISceneConfigurationName: "Default Configuration",
    UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate"
  }]);
  assert.deepEqual(manifest.UISceneConfigurations.OtherRole, [{ UISceneConfigurationName: "External" }]);
  assert.equal(sceneLifecycle.applySingleSceneManifest(updated), updated);
});
