import ExpoModulesCore

public final class LooiRuntimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LooiAppleRuntime")
    Constants {
      #if targetEnvironment(simulator)
      return ["isSimulator": true]
      #else
      return ["isSimulator": false]
      #endif
    }
  }
}
