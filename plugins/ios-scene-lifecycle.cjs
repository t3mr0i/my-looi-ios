const APP_DELEGATE_MARKER = "// LOOI_IOS27_SCENE_LIFECYCLE";

const SCENE_LIFECYCLE_SWIFT = `

${APP_DELEGATE_MARKER}
extension AppDelegate {
  func connectScene(
    _ windowScene: UIWindowScene,
    connectionOptions: UIScene.ConnectionOptions,
    sceneDelegate: SceneDelegate
  ) {
    if hasStartedReactNative {
      sceneDelegate.window = window
      return
    }
    guard let factory = reactNativeFactory else {
      return
    }

    let sceneWindow = UIWindow(windowScene: windowScene)
    window = sceneWindow
    sceneDelegate.window = sceneWindow

    var options = sceneLaunchOptions ?? [:]
    if let context = connectionOptions.urlContexts.first {
      options[.url] = context.url
      if let sourceApplication = context.options.sourceApplication {
        options[.sourceApplication] = sourceApplication
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }
      options[.eventAttribution] = context.options.eventAttribution
    }
    if let userActivity = connectionOptions.userActivities.first {
      var activityOptions: [String: Any] = [
        UIApplication.LaunchOptionsKey.userActivityType.rawValue: userActivity.activityType
      ]
      activityOptions["UIApplicationLaunchOptionsUserActivityKey"] = userActivity
      options[.userActivityDictionary] = activityOptions
    }

    factory.startReactNative(
      withModuleName: "main",
      in: sceneWindow,
      launchOptions: options)
    hasStartedReactNative = true
    sceneLaunchOptions = nil

    for context in connectionOptions.urlContexts {
      _ = application(
        UIApplication.shared,
        open: context.url,
        options: sceneDelegate.applicationOpenURLOptions(from: context.options))
    }
    for userActivity in connectionOptions.userActivities {
      _ = application(
        UIApplication.shared,
        continue: userActivity,
        restorationHandler: { _ in })
    }
  }

  func disconnectScene(_ sceneDelegate: SceneDelegate) {
    guard window === sceneDelegate.window else {
      return
    }
    window = nil
    sceneDelegate.window = nil
    hasStartedReactNative = false
  }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      return
    }
    appDelegate.connectScene(windowScene, connectionOptions: connectionOptions, sceneDelegate: self)
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.disconnectScene(self)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    (UIApplication.shared.delegate as? AppDelegate)?.applicationDidEnterBackground(UIApplication.shared)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      return
    }
    for context in URLContexts {
      _ = appDelegate.application(
        UIApplication.shared,
        open: context.url,
        options: applicationOpenURLOptions(from: context.options))
    }
  }

  func applicationOpenURLOptions(from sceneOptions: UIScene.OpenURLOptions) -> [UIApplication.OpenURLOptionsKey: Any] {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: sceneOptions.openInPlace]
    if let sourceApplication = sceneOptions.sourceApplication {
      options[.sourceApplication] = sourceApplication
    }
    if let annotation = sceneOptions.annotation {
      options[.annotation] = annotation
    }
    if let eventAttribution = sceneOptions.eventAttribution {
      options[.eventAttribution] = eventAttribution
    }
    return options
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      return
    }
    _ = appDelegate.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
  }
}
`;

function countMatches(source, pattern) {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return [...source.matchAll(globalPattern)].length;
}

function replaceExactlyOnce(source, pattern, replacement, description) {
  const count = countMatches(source, pattern);
  if (count !== 1) {
    throw new Error(`Expected exactly one ${description} in Expo AppDelegate.swift; found ${count}.`);
  }
  return source.replace(pattern, replacement);
}

/**
 * Backports the iOS 27 scene lifecycle to the Expo SDK 56 generated AppDelegate.
 * The source matching is intentionally narrow: unexpected generated templates fail
 * during prebuild instead of silently leaving an app that traps at launch.
 */
function transformAppDelegate(source) {
  if (typeof source !== "string") {
    throw new TypeError("AppDelegate source must be a string.");
  }

  if (source.includes(APP_DELEGATE_MARKER)) {
    if (source.includes("class SceneDelegate: UIResponder, UIWindowSceneDelegate") &&
        source.includes("func connectScene(")) {
      return source;
    }
    throw new Error("Found a partial LOOI iOS 27 scene lifecycle marker in AppDelegate.swift.");
  }

  let transformed = source;
  transformed = replaceExactlyOnce(
    transformed,
    /^([ \t]*)var window: UIWindow\?$/gm,
    "$1var window: UIWindow?\n$1var sceneLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?\n$1var hasStartedReactNative = false",
    "AppDelegate window property");

  transformed = replaceExactlyOnce(
    transformed,
    /(^[ \t]*)\) -> Bool \{\r?\n([ \t]*)let delegate = ReactNativeDelegate\(\)/m,
    "$1) -> Bool {\n$2sceneLaunchOptions = launchOptions\n$2let delegate = ReactNativeDelegate()",
    "didFinishLaunchingWithOptions body");

  transformed = replaceExactlyOnce(
    transformed,
    /^[ \t]*window = UIWindow\(frame: UIScreen\.main\.bounds\)\r?\n/m,
    "",
    "legacy frame-based UIWindow creation");

  transformed = replaceExactlyOnce(
    transformed,
    /^[ \t]*factory\.startReactNative\(\r?\n[ \t]*withModuleName: "main",\r?\n[ \t]*in: window,\r?\n[ \t]*launchOptions: launchOptions\)\r?\n/m,
    "",
    "didFinishLaunching React Native startup call");

  transformed = replaceExactlyOnce(
    transformed,
    /return super\.application\(app, open: url, options: options\) \|\| RCTLinkingManager\.application\(app, open: url, options: options\)/,
    "let expoHandled = super.application(app, open: url, options: options)\n    let reactNativeHandled = RCTLinkingManager.application(app, open: url, options: options)\n    return expoHandled || reactNativeHandled",
    "combined Expo and React Native URL handler");

  transformed = transformed.replace(
    /^[ \t]*#if os\(iOS\) \|\| os\(tvOS\)\r?\n[ \t]*\r?\n[ \t]*#endif\r?\n/m,
    "");

  const delegateClassEnd = /\n\}\r?\n\r?\nclass ReactNativeDelegate:/;
  transformed = replaceExactlyOnce(
    transformed,
    delegateClassEnd,
    `\n}${SCENE_LIFECYCLE_SWIFT}\nclass ReactNativeDelegate:`,
    "AppDelegate class boundary before ReactNativeDelegate");

  return transformed;
}

function sceneManifest(moduleName = "$(PRODUCT_MODULE_NAME)") {
  if (typeof moduleName !== "string" || moduleName.length === 0) {
    throw new TypeError("Scene delegate module name must be a non-empty string.");
  }
  return {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [{
        UISceneConfigurationName: "Default Configuration",
        UISceneDelegateClassName: `${moduleName}.SceneDelegate`
      }]
    }
  };
}

function applySingleSceneManifest(infoPlist, moduleName = "$(PRODUCT_MODULE_NAME)") {
  if (!infoPlist || typeof infoPlist !== "object" || Array.isArray(infoPlist)) {
    throw new TypeError("Info.plist must be an object.");
  }
  const existingManifest = infoPlist.UIApplicationSceneManifest ?? {};
  const existingConfigurations = existingManifest.UISceneConfigurations ?? {};
  infoPlist.UIApplicationSceneManifest = {
    ...existingManifest,
    ...sceneManifest(moduleName),
    UISceneConfigurations: {
      ...existingConfigurations,
      ...sceneManifest(moduleName).UISceneConfigurations
    }
  };
  return infoPlist;
}

module.exports = {
  APP_DELEGATE_MARKER,
  applySingleSceneManifest,
  sceneManifest,
  transformAppDelegate
};
