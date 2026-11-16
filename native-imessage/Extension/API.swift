import Foundation
import Security

enum Config {
    static let api = URL(string: "https://reliable-kookabura-33.convex.cloud")!
    static let web = URL(string: "https://reliable-kookabura-33.convex.site")!
}

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct Ignored: Decodable {
    init() {}
    init(from decoder: Decoder) throws {}
}

private struct Envelope<T: Decodable>: Decodable {
    let status: String
    let value: T?
    let errorMessage: String?
    let errorData: String?

    enum CodingKeys: String, CodingKey { case status, value, errorMessage, errorData }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decode(String.self, forKey: .status)
        errorMessage = try? c.decodeIfPresent(String.self, forKey: .errorMessage)
        errorData = try? c.decodeIfPresent(String.self, forKey: .errorData)
        value = status == "success" ? try c.decodeIfPresent(T.self, forKey: .value) : nil
    }
}

enum API {
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        return URLSession(configuration: config)
    }()

    static func run<T: Decodable>(_ kind: String, _ path: String, _ args: [String: Any]) async throws -> T? {
        var request = URLRequest(url: Config.api.appendingPathComponent("api/\(kind)"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["path": path, "args": args, "format": "json"])
        let data: Data
        do {
            (data, _) = try await session.data(for: request)
        } catch {
            throw APIError(message: "Can't reach Called It. Check your connection.")
        }
        let envelope: Envelope<T>
        do {
            envelope = try JSONDecoder().decode(Envelope<T>.self, from: data)
        } catch {
            throw APIError(message: "Unexpected reply from Called It.")
        }
        if envelope.status != "success" {
            throw APIError(message: envelope.errorData ?? friendly(envelope.errorMessage))
        }
        return envelope.value
    }

    static func query<T: Decodable>(_ path: String, _ args: [String: Any]) async throws -> T? { try await run("query", path, args) }
    static func mutation<T: Decodable>(_ path: String, _ args: [String: Any]) async throws -> T? { try await run("mutation", path, args) }
    static func action<T: Decodable>(_ path: String, _ args: [String: Any]) async throws -> T? { try await run("action", path, args) }

    private static func friendly(_ raw: String?) -> String {
        guard let raw else { return "Something went wrong." }
        if let range = raw.range(of: "Uncaught Error: ") {
            let tail = raw[range.upperBound...]
            return String(tail.split(separator: "\n").first ?? tail)
        }
        if raw.contains("ArgumentValidationError") { return "The server didn't accept that request." }
        return "Something went wrong."
    }
}

enum Keychain {
    private static let base: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.mikunad.calledit.session",
        kSecAttrAccount as String: "token",
    ]

    static func save(_ token: String) {
        SecItemDelete(base as CFDictionary)
        var item = base
        item[kSecValueData as String] = Data(token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(item as CFDictionary, nil)
    }

    static func load() -> String? {
        var q = base
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete() {
        SecItemDelete(base as CFDictionary)
    }
}

func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

func clock(_ ms: Double) -> String {
    let f = DateFormatter()
    f.dateFormat = "h:mm a"
    return f.string(from: Date(timeIntervalSince1970: ms / 1000))
}

func pts(_ value: Double) -> String { String(Int(value.rounded())) }
