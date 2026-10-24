import Foundation
import ExpoModulesCore
import PhotosUI
import UniformTypeIdentifiers
import LooiAppleRuntime

public final class PhotoPickerAccessModule: Module {
  private var promise: Promise?
  private var selection: [String: [String: Any]] = [:]
  private var selectionGeneration = 0
  private var loadProgress: Progress?
  private weak var pickerController: PHPickerViewController?

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
        self.selectionGeneration += 1
        self.selection.removeAll(); self.promise = promise
        self.pickerController = picker
        try LooiAppleUI.presenter().present(picker, animated: true)
      } catch { self.promise = nil; promise.reject(error) }
    }.runOnQueue(.main)
    AsyncFunction("readSelectedPhotoForRealtime") { (uri: String) -> [String: Any] in
      guard let photo = self.selection[uri] else { throw looiError("This photo is outside the current selection") }
      return photo
    }.runOnQueue(.main)
    AsyncFunction("clearSelection") { self.cancelSelection() }.runOnQueue(.main)
    OnAppEntersBackground { DispatchQueue.main.async { self.cancelSelection() } }
    OnDestroy { DispatchQueue.main.async { self.cancelSelection() } }
  }

  public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    guard pickerController === picker, let pending = promise else { return }
    picker.dismiss(animated: true)
    pickerController = nil
    let generation = selectionGeneration
    if results.isEmpty { promise = nil; pending.resolve([] as [[String: Any]]); return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
      guard let self, self.selectionGeneration == generation, self.promise != nil else { return }
      self.cancelSelection(error: looiError("The photo provider timed out; select the images again"))
    }
    loadSelection(results, index: 0, photos: [], pending: pending, generation: generation)
  }

  // Decode selected images sequentially to bound peak memory, including iCloud
  // providers returning large originals. Only normalized JPEGs remain in memory.
  private func loadSelection(_ results: [PHPickerResult], index: Int, photos: [[String: Any]], pending: Promise, generation: Int) {
    guard generation == selectionGeneration, promise != nil else { return }
    guard index < results.count else { loadProgress = nil; promise = nil; pending.resolve(photos); return }
    let provider = results[index].itemProvider
    let type = provider.registeredTypeIdentifiers.first {
      UTType($0)?.conforms(to: .image) == true
    } ?? UTType.image.identifier
    loadProgress = provider.loadDataRepresentation(forTypeIdentifier: type) { [weak self] data, error in
      do {
        if let error { throw error }
        guard let data else { throw looiError("The photo provider did not return an image") }
        let (jpeg, width, height) = try LooiImage.jpeg(data)
        let uri = "looi-photo://\(UUID().uuidString)"
        let payload: [String: Any] = ["uri": uri, "mimeType": "image/jpeg", "base64": jpeg.base64EncodedString(),
          "width": width, "height": height, "encodedBytes": jpeg.count,
          "originalMimeType": UTType(type)?.preferredMIMEType ?? "image/*"]
        DispatchQueue.main.async {
          guard let self, self.selectionGeneration == generation, self.promise != nil else { return }
          self.selection[uri] = payload
          let photo: [String: Any] = ["uri": uri, "mimeType": "image/jpeg", "sizeBytes": jpeg.count, "persistedGrant": false]
          self.loadSelection(results, index: index + 1, photos: photos + [photo], pending: pending, generation: generation)
        }
      } catch {
        DispatchQueue.main.async {
          guard let self, self.selectionGeneration == generation else { return }
          self.cancelSelection(error: error)
        }
      }
    }
  }
  // Main-thread only. Invalidating the generation before canceling the provider
  // prevents its late completion from repopulating a cleared/new selection.
  private func cancelSelection(error: Error? = nil) {
    selectionGeneration += 1
    loadProgress?.cancel(); loadProgress = nil
    pickerController?.dismiss(animated: true); pickerController = nil
    selection.removeAll()
    let pending = promise; promise = nil
    if let error { pending?.reject(error) }
    else { pending?.resolve([] as [[String: Any]]) }
  }

}

private final class PhotoPickerAccessModuleDelegate: NSObject, PHPickerViewControllerDelegate {
  weak var owner: PhotoPickerAccessModule?
  init(_ owner: PhotoPickerAccessModule) { self.owner = owner; super.init() }
  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    owner?.picker(picker, didFinishPicking: results)
  }
}
