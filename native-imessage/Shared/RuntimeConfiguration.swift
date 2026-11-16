import Foundation

struct RuntimeConfiguration: Equatable {
    enum Channel: String { case qa, release }

    let channel: Channel
    let environmentID: String
    let sourceRevision: String
    let backendRevision: String
    let deploymentID: String
    let configVersion: String
    let apiURL: URL
    let cardBaseURL: URL
    let appGroup: String
    let keychainGroup: String

    init(values: [String: Any]) throws {
        func required(_ name: String) throws -> String {
            guard let value = values[name] as? String, !value.isEmpty, !value.contains("$(") else {
                throw NativeError.configuration
            }
            return value
        }
        func endpoint(_ name: String) throws -> URL {
            let raw = try required(name)
            guard let parts = URLComponents(string: raw), parts.scheme == "https",
                  let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
                  parts.query == nil, parts.fragment == nil, parts.port == nil,
                  parts.path.isEmpty || parts.path == "/", let url = parts.url else {
                throw NativeError.configuration
            }
            return url
        }
        guard let channel = Channel(rawValue: try required("CalledItChannel")) else {
            throw NativeError.configuration
        }
        self.channel = channel
        environmentID = try required("CalledItReleaseEnvironment")
        guard ["local", "staging", "production"].contains(environmentID),
              channel != .qa || environmentID != "production" else { throw NativeError.configuration }
        sourceRevision = try required("CalledItSourceRevision")
        backendRevision = try required("CalledItExpectedBackendRevision")
        deploymentID = try required("CalledItDeploymentID")
        configVersion = try required("CalledItConfigVersion")
        apiURL = try endpoint("CalledItAPIURL")
        cardBaseURL = try endpoint("CalledItWebURL")
        guard apiURL.host == (try required("CalledItExpectedAPIHost")),
              cardBaseURL.host == (try required("CalledItExpectedCardHost")),
              channel != .release || (!apiURL.host!.hasSuffix(".invalid") && !cardBaseURL.host!.hasSuffix(".invalid")) else {
            throw NativeError.configuration
        }
        appGroup = try required("CalledItAppGroup")
        keychainGroup = try required("CalledItKeychainGroup")
        guard values["CalledItFixtureMode"] as? Bool == false else { throw NativeError.configuration }
    }

    static func load(bundle: Bundle = .main) throws -> RuntimeConfiguration {
        try RuntimeConfiguration(values: bundle.infoDictionary ?? [:])
    }
}

enum NativeError: LocalizedError {
    case configuration
    case sessionStorage
    case unavailable
    case invalidLink
    case sessionExpired

    var errorDescription: String? {
        switch self {
        case .configuration: return "This build isn't connected to a verified Called It environment."
        case .sessionStorage: return "Called It couldn't access its shared sign-in. Unlock your device and try again."
        case .unavailable: return "Phone sign-in isn't configured for this build yet."
        case .invalidLink: return "This card can't be opened here. Ask the sender to share a new card."
        case .sessionExpired: return "Your sign-in has ended. Sign in again in the Called It app."
        }
    }
}
