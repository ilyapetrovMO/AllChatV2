import Foundation
import React
import UIKit

@objc(AllChatMediaSaver)
final class AllChatMediaSaver: NSObject, RCTBridgeModule {
  static func moduleName() -> String! { "AllChatMediaSaver" }
  static func requiresMainQueueSetup() -> Bool { false }

  @objc(save:token:filename:mimeType:resolver:rejecter:)
  func save(
    _ urlString: String,
    token: String,
    filename: String,
    mimeType: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let url = URL(string: urlString), ["http", "https"].contains(url.scheme?.lowercased()) else {
      reject("invalid_url", "Only HTTP media can be saved.", nil)
      return
    }
    var request = URLRequest(url: url)
    if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    URLSession.shared.downloadTask(with: request) { temporaryURL, response, error in
      guard let temporaryURL, error == nil else {
        reject("save_failed", error?.localizedDescription ?? "Could not download media.", error)
        return
      }
      let safeName = self.sanitizeFilename(filename)
      let savedURL = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
        .appendingPathComponent(safeName)
      do {
        try FileManager.default.createDirectory(
          at: savedURL.deletingLastPathComponent(),
          withIntermediateDirectories: true
        )
        try FileManager.default.moveItem(at: temporaryURL, to: savedURL)
      } catch {
        reject("save_failed", error.localizedDescription, error)
        return
      }
      DispatchQueue.main.async {
        guard let presenter = self.topViewController() else {
          try? FileManager.default.removeItem(at: savedURL.deletingLastPathComponent())
          reject("save_failed", "Could not present the save sheet.", nil)
          return
        }
        let sheet = UIActivityViewController(activityItems: [savedURL], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
          popover.sourceView = presenter.view
          popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
        }
        sheet.completionWithItemsHandler = { _, _, _, _ in
          try? FileManager.default.removeItem(at: savedURL.deletingLastPathComponent())
        }
        presenter.present(sheet, animated: true) { resolve("share") }
      }
    }.resume()
  }

  private func sanitizeFilename(_ value: String) -> String {
    let last = (value as NSString).lastPathComponent
    let invalid = CharacterSet(charactersIn: "\\/:*?\"<>|").union(.controlCharacters)
    let cleaned = last.components(separatedBy: invalid).joined(separator: "_")
    return String(cleaned.prefix(180)).isEmpty ? "allchat-media" : String(cleaned.prefix(180))
  }

  private func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    var controller = scenes.flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController
    while let presented = controller?.presentedViewController { controller = presented }
    return controller
  }
}
