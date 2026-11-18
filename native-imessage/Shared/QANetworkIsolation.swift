#if QA
import Foundation

/// How a QA run treats traffic leaving the simulator.
/// `denied`: the provisioner that issued the manifest blocked it and says so.
/// `observed`: nothing blocked it; the runner only watched. Accepted solely in a QA build on a simulator whose API and
/// card origins are both numeric loopback, and never to be read as `denied`.
/// This file is named QA*.swift, which the project excludes from Debug and Release builds.
enum QANetworkIsolation: String, Equatable {
    case denied
    case observed

    static let observedField = "outboundNetworkObserved"
    var diagnostic: String { self == .denied ? "denied" : "observed_not_denied" }

    #if targetEnvironment(simulator)
    static let runningOnSimulator = true
    #else
    static let runningOnSimulator = false
    #endif

    /// Returns nil when the manifest proves neither mode.
    static func resolve(manifest: [String: Any], buildChannel: String?, isSimulator: Bool = runningOnSimulator) -> QANetworkIsolation? {
        guard let denied = manifest["outboundNetworkDenied"] as? Bool else { return nil }
        let observed = manifest[observedField]
        if denied { return observed == nil ? .denied : nil }
        guard observed as? Bool == true, isSimulator, buildChannel == "qa",
              loopback(manifest["apiOrigin"]), loopback(manifest["cardOrigin"]) else { return nil }
        return .observed
    }

    private static func loopback(_ value: Any?) -> Bool {
        guard let text = value as? String, text.hasPrefix("http://127.0.0.1:"), let parts = URLComponents(string: text) else { return false }
        return parts.scheme == "http" && parts.host == "127.0.0.1" && parts.port != nil && parts.user == nil
    }
}
#endif
