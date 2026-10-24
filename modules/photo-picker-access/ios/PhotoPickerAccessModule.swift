import Foundation
import ExpoModulesCore
import PhotosUI
import UniformTypeIdentifiers
import LooiAppleRuntime

public final class PhotoPickerAccessModule: Module {
  private var promise: Promise?
  private var selection: [String: [String: Any]] = [:]

  private lazy var nativeDelegate = PhotoPickerAccessModuleDelegate(self)

  public func definition() -> ModuleDefinition {
    Name("PhotoPickerAccess")
    AsyncFunction("selectPhotos") { (maxItems: Int, promise: Promise) in
      guard self.promise == nil else { promise.reject("ERR_PICKER_BUSY", "Photo selection is already open"); return }
      do {
        var config = PHPickerConfiguration()
        config.filter = .images; config.selectionLimit = min(4, max(1, maxItems))
        config.selection = .ordered
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self.nativeDelegate
        self.selection.removeAll(); self.promise = promise
        try LooiAppleUI.presenter().present(picker, animated: true)
      } catch { self.promise = nil; promise.reject(error) }
    }.runOnQueue(.main)
    AsyncFunction("readSelectedPhotoForRealtime") { (uri: String) -> [String: Any] in
      guard let photo = self.selection[uri] else { throw looiError("This photo is outside the current selection") }
      return photo
    }.runOnQueue(.main)
    AsyncFunction("clearSelection") { self.selection.removeAll() }.runOnQueue(.main)
    OnDestroy { self.promise?.reject("ERR_CANCELLED", "Photo selection ended"); self.promise = nil; self.selection.removeAll() }
  }

  public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let pending = promise else { return }
    if results.isEmpty { promise = nil; pending.resolve([] as [[String: Any]]); return }
    loadSelection(results, index: 0, photos: [], pending: pending)
  }

  // Decode selected images sequentially to bound peak memory, including iCloud
  // providers returning large originals. Only normalized JPEGs remain in memory.
  private func loadSelection(_ results: [PHPickerResult], index: Int, photos: [[String: Any]], pending: Promise) {
    guard index < results.count else { promise = nil; pending.resolve(photos); return }
    let provider = results[index].itemProvider
    let type = provider.registeredTypeIdentifiers.first {
      UTType($0)?.conforms(to: .image) == true
    } ?? UTType.image.identifier
    provider.loadDataRepresentation(forTypeIdentifier: type) { [weak self] data, error in
      do {
        if let error { throw error }
        guard let data else { throw looiError("The photo provider did not return an image") }
        let (jpeg, width, height) = try LooiImage.jpeg(data)
        let uri = "looi-photo://\(UUID().uuidString)"
        let payload: [String: Any] = ["uri": uri, "mimeType": "image/jpeg", "base64": jpeg.base64EncodedString(),
          "width": width, "height": height, "encodedBytes": jpeg.count,
          "originalMimeType": UTType(type)?.preferredMIMEType ?? "image/*"]
        DispatchQueue.main.async {
          guard let self, self.promise != nil else { return }
          self.selection[uri] = payload
          let photo: [String: Any] = ["uri": uri, "mimeType": "image/jpeg", "sizeBytes": jpeg.count, "persistedGrant": false]
          self.loadSelection(results, index: index + 1, photos: photos + [photo], pending: pending)
        }
      } catch {
        DispatchQueue.main.async {
          guard let self else { return }
          self.promise = nil; self.selection.removeAll(); pending.reject(error)
        }
      }
    }
  }
}

private final class PhotoPickerAccessModuleDelegate: NSObject, PHPickerViewControllerDelegate {
  weak var owner: PhotoPickerAccessModule?
  init(_ owner: PhotoPickerAccessModule) { self.owner = owner; super.init() }
  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    owner?.picker(picker, didFinishPicking: results)
  }
}
