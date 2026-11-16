import Foundation

enum Config {
    static func load() throws -> RuntimeConfiguration { try RuntimeConfiguration.load() }
}

struct APIError: LocalizedError {
    let code: String
    var errorDescription: String? {
        switch code {
        case "AUTH_REQUIRED": return "Sign in again in the Called It app."
        case "NOT_AVAILABLE", "FORBIDDEN": return "This isn't available to your account. An earlier card may be outside your membership."
        case "POLICY_PENDING": return "The group's game rules are awaiting approval. No score or reward has been calculated."
        case "RATE_LIMITED": return "Please wait before trying again."
        case "PROVIDER_UNAVAILABLE": return "This service is temporarily unavailable. Try again later."
        case "CONFLICT", "IDEMPOTENCY_CONFLICT": return "This changed while you were away. Refresh before trying again."
        case "INVALID_INPUT": return "Check your entries and try again."
        default: return "Couldn't complete this request. Check your connection and try again."
        }
    }
}

struct Ignored: Decodable {
    init() {}
    init(from decoder: Decoder) throws {}
}

struct RuntimeAttestation: Decodable {
    let app: String
    let contractVersion: String
    let schemaVersion: String
    let environment: String
    let sourceSha: String?
    let deploymentId: String?
    let configVersion: String?
    let testAdapters: Bool

    func validate(configuration: RuntimeConfiguration) throws {
        guard app == "called-it", contractVersion == "v0.1", schemaVersion == "v0.1", !testAdapters,
              environment == configuration.environmentID,
              sourceSha == configuration.backendRevision, deploymentId == configuration.deploymentID,
              configVersion == configuration.configVersion,
              configuration.channel != .qa || environment != "production" else { throw NativeError.configuration }
    }
}

private struct Envelope<T: Decodable>: Decodable {
    let status: String
    let value: T?
    let errorData: String?

    enum CodingKeys: String, CodingKey { case status, value, errorData }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        status = try values.decode(String.self, forKey: .status)
        value = status == "success" ? try values.decodeIfPresent(T.self, forKey: .value) : nil
        errorData = try? values.decodeIfPresent(String.self, forKey: .errorData)
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct ServerFailure: Decodable { let code: String }

enum API {
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }()

    private static func request<T: Decodable>(_ kind: String, _ path: String, _ args: [String: Any], configuration: RuntimeConfiguration) async throws -> T? {
        var request = URLRequest(url: configuration.apiURL.appendingPathComponent("api/\(kind)"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["path": path, "args": args, "format": "json"])
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
              response.url?.host == configuration.apiURL.host else { throw APIError(code: "TRANSPORT") }
        let envelope = try JSONDecoder().decode(Envelope<T>.self, from: data)
        guard envelope.status == "success" else {
            let failure = envelope.errorData.flatMap { $0.data(using: .utf8) }.flatMap { try? JSONDecoder().decode(ServerFailure.self, from: $0) }
            throw APIError(code: failure?.code ?? "UNKNOWN")
        }
        return envelope.value
    }

    static func run<T: Decodable>(_ kind: String, _ path: String, _ args: [String: Any]) async throws -> T? {
        guard path.hasPrefix("v0"), ["query", "mutation", "action"].contains(kind), args["now"] == nil else {
            throw APIError(code: "NOT_AVAILABLE")
        }
        let configuration = try Config.load()
        guard let attestation: RuntimeAttestation = try await request("query", "v0Runtime:attestation", [:], configuration: configuration) else {
            throw NativeError.configuration
        }
        try attestation.validate(configuration: configuration)
        return try await request(kind, path, args, configuration: configuration)
    }

    static func query<T: Decodable>(_ path: String, _ args: [String: Any]) async throws -> T? { try await run("query", path, args) }
    static func mutation<T: Decodable>(_ path: String, _ args: [String: Any]) async throws -> T? { try await run("mutation", path, args) }
    static func action<T: Decodable>(_ path: String, _ args: [String: Any]) async throws -> T? { try await run("action", path, args) }
}

func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

func clock(_ ms: Double) -> String {
    let formatter = DateFormatter()
    formatter.dateStyle = .none
    formatter.timeStyle = .short
    return formatter.string(from: Date(timeIntervalSince1970: ms / 1000))
}

func pts(_ value: Double) -> String { String(Int(value.rounded())) }
