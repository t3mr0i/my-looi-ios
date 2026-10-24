import Foundation
import ExpoModulesCore
import ZIPFoundation
import Darwin

public final class DiagnosticArchiveModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DiagnosticArchive")
    AsyncFunction("createZip") { (source: String, destination: String) -> [String: Any] in
      guard let directory = URL(string: source), directory.isFileURL,
        let output = URL(string: destination), output.isFileURL else {
        throw NSError(domain: "MyLOOI", code: 1, userInfo: [NSLocalizedDescriptionKey: "Private file URLs are required"])
      }
      let root = directory.resolvingSymlinksInPath().standardizedFileURL
      let target = output.resolvingSymlinksInPath().standardizedFileURL
      guard !target.path.hasPrefix(root.path + "/"), target != root else {
        throw NSError(domain: "MyLOOI", code: 1, userInfo: [NSLocalizedDescriptionKey: "Archive must be outside its source directory"])
      }
      let manager = FileManager.default
      var entries = 0
      var bytes = 0
      if let enumerator = manager.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .isSymbolicLinkKey]) {
        for case let file as URL in enumerator {
          let values = try file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .isSymbolicLinkKey])
          guard values.isSymbolicLink != true else {
            throw NSError(domain: "MyLOOI", code: 1, userInfo: [NSLocalizedDescriptionKey: "Diagnostic source contains a symbolic link"])
          }
          if values.isRegularFile == true { entries += 1; bytes += values.fileSize ?? 0 }
        }
      }
      try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
      if manager.fileExists(atPath: target.path) { try manager.removeItem(at: target) }
      try manager.zipItem(at: root, to: target, shouldKeepParent: false)
      return ["outputUri": target.absoluteString, "entries": entries, "uncompressedBytes": bytes]
    }
    AsyncFunction("getPerformanceSnapshot") { self.performanceSnapshot() }
  }

  private func performanceSnapshot() -> [String: Any] {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
      }
    }
    // RSS is measurable on iOS. PSS, Java heaps and Android low-memory
    // thresholds are distinct metrics and must not be filled with substitutes.
    let rss: Any = result == KERN_SUCCESS ? NSNumber(value: UInt64(info.resident_size) / 1024) : NSNull()
    return ["platform": "ios", "pid": ProcessInfo.processInfo.processIdentifier,
      "elapsedRealtimeMs": ProcessInfo.processInfo.systemUptime * 1000,
      "rssKb": rss, "pssKb": NSNull(), "javaHeapUsedBytes": NSNull(),
      "javaHeapTotalBytes": NSNull(), "javaHeapMaxBytes": NSNull(),
      "nativeHeapBytes": NSNull(), "systemAvailMemBytes": NSNull(),
      "systemTotalMemBytes": ProcessInfo.processInfo.physicalMemory,
      "systemLowMemory": NSNull(), "systemLowMemoryThresholdBytes": NSNull(),
      "thermalState": ProcessInfo.processInfo.thermalState.rawValue]
  }
}
