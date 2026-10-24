import Foundation
import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers
import LooiAppleRuntime

public final class BackupStorageAccessModule: Module {
  private var pickerPromise: Promise?
  private let prefix = "mylooi.folder."
  private let files = FileManager.default

  private lazy var nativeDelegate = BackupStorageAccessModuleDelegate(self)

  public func definition() -> ModuleDefinition {
    Name("BackupStorageAccess")
    AsyncFunction("selectFolder") { (promise: Promise) in
      guard self.pickerPromise == nil else { promise.reject("ERR_PICKER_BUSY", "Folder selection is already open"); return }
      do {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
        picker.delegate = self.nativeDelegate; picker.allowsMultipleSelection = false
        self.pickerPromise = promise
        try LooiAppleUI.presenter().present(picker, animated: true)
      } catch { self.pickerPromise = nil; promise.reject(error) }
    }.runOnQueue(.main)
    AsyncFunction("inspectFolder") { (uri: String) in
      try self.withFolder(uri) { url in try self.folderStatus(uri, url) }
    }
    AsyncFunction("inspectFile") { (uri: String, name: String) -> [String: Any]? in
      try self.withFolder(uri) { url in
        let file = try self.child(url, name)
        return self.files.fileExists(atPath: file.path) ? try self.fileStatus(file) : nil
      }
    }
    AsyncFunction("writeTextFile") { (uri: String, name: String, text: String) in
      try self.withFolder(uri) { folder in
        let url = try self.child(folder, name)
        guard let data = text.data(using: .utf8), data.count <= 16 * 1024 * 1024 else { throw looiError("Backup exceeds 16 MB") }
        try self.coordinatedWrite(url, data: data); return try self.fileStatus(url)
      }
    }
    AsyncFunction("writePrivateFile") { (uri: String, name: String, _: String, source: String) in
      try self.withFolder(uri) { folder in
        guard let local = URL(string: source), local.isFileURL else { throw looiError("A private file URL is required") }
        let url = try self.child(folder, name)
        let data = try Data(contentsOf: local, options: .mappedIfSafe)
        try self.coordinatedWrite(url, data: data); return try self.fileStatus(url)
      }
    }
    AsyncFunction("readTextFile") { (uri: String, name: String, maxBytes: Int) in
      try self.withFolder(uri) { folder -> [String: Any] in
        let url = try self.child(folder, name)
        var result: [String: Any] = [:]
        var failure: Error?
        var coordinationError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinated in
          do {
            let size = try coordinated.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= min(16 * 1024 * 1024, max(0, maxBytes)) else { throw looiError("Backup is too large") }
            let data = try Data(contentsOf: coordinated)
            guard data.count <= maxBytes, let text = String(data: data, encoding: .utf8) else { throw looiError("Invalid UTF-8 backup") }
            result = ["file": try self.fileStatus(url), "content": text, "bytes": data.count]
          } catch { failure = error }
        }
        if let error = coordinationError ?? (failure as NSError?) { throw error }
        return result
      }
    }
    AsyncFunction("releaseFolder") { (uri: String) in UserDefaults.standard.removeObject(forKey: self.prefix + uri) }
    OnDestroy { self.pickerPromise?.reject("ERR_CANCELLED", "Folder selection ended"); self.pickerPromise = nil }
  }

  public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pickerPromise?.reject("ERR_CANCELLED", "Folder selection was cancelled"); pickerPromise = nil
  }
  public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    defer { pickerPromise = nil }
    do {
      guard let url = urls.first, url.startAccessingSecurityScopedResource() else { throw looiError("Folder access was not granted") }
      defer { url.stopAccessingSecurityScopedResource() }
      // On iOS document-provider bookmarks preserve the picker-granted scope.
      let bookmark = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
      let uri = "looi-folder://\(UUID().uuidString)"
      UserDefaults.standard.set(bookmark, forKey: prefix + uri)
      pickerPromise?.resolve(try folderStatus(uri, url))
    } catch { pickerPromise?.reject(error) }
  }
  private func withFolder<T>(_ uri: String, _ body: (URL) throws -> T) throws -> T {
    guard let data = UserDefaults.standard.data(forKey: prefix + uri) else { throw looiError("Select the folder again") }
    var stale = false
    let url = try URL(resolvingBookmarkData: data, options: .withoutUI, relativeTo: nil, bookmarkDataIsStale: &stale)
    guard url.startAccessingSecurityScopedResource() else { throw looiError("Folder access expired; select it again") }
    defer { url.stopAccessingSecurityScopedResource() }
    if stale {
      let refreshed = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
      UserDefaults.standard.set(refreshed, forKey: prefix + uri)
    }
    return try body(url)
  }
  private func child(_ folder: URL, _ name: String) throws -> URL {
    guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\\") else { throw looiError("Invalid filename") }
    let url = folder.appendingPathComponent(name)
    let resolved = url.resolvingSymlinksInPath().standardizedFileURL
    guard resolved.deletingLastPathComponent() == folder.resolvingSymlinksInPath().standardizedFileURL else { throw looiError("File is outside the selected folder") }
    return url
  }
  private func folderStatus(_ uri: String, _ url: URL) throws -> [String: Any] {
    let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isReadableKey, .isWritableKey])
    guard values.isDirectory == true else { throw looiError("The selected item is not a folder") }
    return ["uri": uri, "displayName": url.lastPathComponent, "providerName": "Files",
      "canRead": values.isReadable ?? false, "canWrite": values.isWritable ?? false]
  }
  private func fileStatus(_ url: URL) throws -> [String: Any] {
    let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
    return ["uri": url.absoluteString, "name": url.lastPathComponent, "size": values.fileSize ?? 0,
      "modifiedTime": (values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000]
  }
  private func coordinatedWrite(_ url: URL, data: Data) throws {
    var error: NSError?
    var failure: Error?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forReplacing, error: &error) { file in
      do { try data.write(to: file, options: .atomic) } catch { failure = error }
    }
    if let error = error ?? (failure as NSError?) { throw error }
  }
}

private final class BackupStorageAccessModuleDelegate: NSObject, UIDocumentPickerDelegate {
  weak var owner: BackupStorageAccessModule?
  init(_ owner: BackupStorageAccessModule) { self.owner = owner; super.init() }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { owner?.documentPickerWasCancelled(controller) }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    owner?.documentPicker(controller, didPickDocumentsAt: urls)
  }
}
