import Foundation
import Security
import UserNotifications

private struct StoredConnection: Decodable {
  let server: String
  let token: String
  let deviceId: String?
}

private struct EventEnvelope: Decodable {
  let data: EventRecord
}

private struct EventRecord: Decodable {
  struct Target: Decodable {
    let ticketKey: String?
  }

  let kind: String
  let target: Target
  let subject: String
  let detail: String?
}

private func kindLabel(_ kind: String) -> String? {
  switch kind {
  case "question": return "Question"
  case "permission": return "Permission"
  case "human-check": return "Human Check"
  case "failed": return "Failed"
  case "disconnected": return "Disconnected"
  case "runner-offline", "runner-auth", "runner-usage-limit": return "Runner Issue"
  default: return nil
  }
}

private func categoryIdentifier(_ kind: String) -> String? {
  switch kind {
  case "question": return "question"
  case "human-check": return "human-check"
  default: return nil
  }
}

private func readConnection() -> StoredConnection? {
  guard
    let group = Bundle.main.object(forInfoDictionaryKey: "GangerKeychainAccessGroup") as? String
  else { return nil }
  let key = Data("ganger.connection".utf8)
  let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "app:no-auth",
    kSecAttrGeneric as String: key,
    kSecAttrAccount as String: key,
    kSecAttrAccessGroup as String: group,
    kSecMatchLimit as String: kSecMatchLimitOne,
    kSecReturnData as String: true,
  ]
  var item: CFTypeRef?
  guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
    let data = item as? Data
  else { return nil }
  return try? JSONDecoder().decode(StoredConnection.self, from: data)
}

final class NotificationService: UNNotificationServiceExtension {
  private let lock = NSLock()
  private var deliver: ((UNNotificationContent) -> Void)?
  private var best: UNMutableNotificationContent?
  private var task: URLSessionDataTask?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    deliver = contentHandler
    best = content
    let body = request.content.userInfo["body"] as? [String: Any]
    guard let device = body?["device"] as? String,
      let connection = readConnection(),
      connection.deviceId == device
    else {
      finish()
      return
    }
    removeReplaced(body?["replaces"] as? [String] ?? [], device: device) { [weak self] in
      guard let self else { return }
      guard let eventId = (body?["eventId"] as? NSNumber)?.intValue else {
        self.finish()
        return
      }
      self.fill(content, eventId: eventId, connection: connection)
    }
  }

  override func serviceExtensionTimeWillExpire() {
    task?.cancel()
    finish()
  }

  private func removeReplaced(
    _ ids: [String],
    device: String,
    then next: @escaping () -> Void
  ) {
    guard !ids.isEmpty else {
      next()
      return
    }
    let replaced = Set(ids)
    let center = UNUserNotificationCenter.current()
    center.getDeliveredNotifications { delivered in
      let identifiers = delivered.compactMap { notification -> String? in
        let body = notification.request.content.userInfo["body"] as? [String: Any]
        guard body?["device"] as? String == device else { return nil }
        if let bundleId = body?["bundleId"] as? String, replaced.contains(bundleId) {
          return notification.request.identifier
        }
        if let eventId = (body?["eventId"] as? NSNumber)?.intValue,
          replaced.contains("event-\(eventId)")
        {
          return notification.request.identifier
        }
        return nil
      }
      center.removeDeliveredNotifications(withIdentifiers: identifiers)
      next()
    }
  }

  private func fill(
    _ content: UNMutableNotificationContent,
    eventId: Int,
    connection: StoredConnection
  ) {
    let base = connection.server.hasSuffix("/")
      ? String(connection.server.dropLast()) : connection.server
    guard let url = URL(string: "\(base)/api/v1/notification-events/\(eventId)") else {
      finish()
      return
    }
    var request = URLRequest(url: url, timeoutInterval: 20)
    request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
    let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
      guard let self else { return }
      if let data, (response as? HTTPURLResponse)?.statusCode == 200,
        let record = try? JSONDecoder().decode(EventEnvelope.self, from: data).data,
        let label = kindLabel(record.kind)
      {
        self.lock.lock()
        content.title = record.target.ticketKey.map { "\(label) · \($0)" } ?? label
        content.body = record.kind == "runner-usage-limit"
          ? [record.subject, record.detail].compactMap { $0 }.joined(separator: " · ")
          : record.detail ?? record.subject
        if let category = categoryIdentifier(record.kind) {
          content.categoryIdentifier = category
        }
        self.lock.unlock()
      }
      self.finish()
    }
    self.task = task
    task.resume()
  }

  private func finish() {
    lock.lock()
    let handler = deliver
    let content = best
    deliver = nil
    lock.unlock()
    if let handler, let content {
      handler(content)
    }
  }
}
