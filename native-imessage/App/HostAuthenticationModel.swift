import Foundation
import SwiftUI

@MainActor
final class HostAuthenticationModel: ObservableObject {
    @Published var phone = ""
    @Published var code = ""
    @Published private(set) var challenge: PhoneChallenge?
    @Published private(set) var session: SharedSession?
    @Published private(set) var busy = false
    @Published private(set) var hasPendingCard = false
    @Published private(set) var error: String?
    private let service: any PhoneAuthenticating

    init(service: any PhoneAuthenticating = VerifiedPhoneAuthentication()) {
        self.service = service
        reload()
    }

    func reload() {
        do {
            let configuration = try Config.load()
            session = try SessionStore.load(configuration: configuration)
            hasPendingCard = try SharedState.defaults(configuration: configuration).data(forKey: "pendingCard") != nil
            error = nil
        } catch {
            session = nil
            self.error = error.localizedDescription
        }
    }

    func resetChallenge() {
        challenge = nil
        code = ""
        error = nil
    }

    func request() async {
        guard !busy else { return }
        let normalized = phone.filter { !$0.isWhitespace && $0 != "-" && $0 != "(" && $0 != ")" }
        guard normalized.first == "+", (8...15).contains(normalized.dropFirst().count),
              normalized.dropFirst().allSatisfy({ $0.isASCII && $0.isNumber }) else {
            error = "Enter your phone number with its country code, starting with +."
            return
        }
        busy = true
        defer { busy = false }
        do {
            _ = try Config.load()
            challenge = try await service.requestCode(phone: normalized)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func verify() async {
        guard !busy, let challenge, !code.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            let verified = try await service.verifyCode(challenge: challenge, code: code)
            let configuration = try Config.load()
            if let previous = session, previous.accountID != verified.accountID {
                try SharedState.clearAccount(previous.accountID, configuration: configuration)
            }
            try SessionStore.save(verified, configuration: configuration)
            session = verified
            phone = ""
            resetChallenge()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func signOut() async {
        guard !busy, let session else { return }
        busy = true
        defer { busy = false }
        do {
            try await service.revoke(session: session)
            let configuration = try Config.load()
            try SessionStore.delete(configuration: configuration)
            try SharedState.clearAccount(session.accountID, configuration: configuration)
            self.session = nil
            hasPendingCard = false
            resetChallenge()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func open(_ url: URL) {
        if url.scheme == "calledit-host", url.host == "signin", url.query == nil { reload(); return }
        do {
            let configuration = try Config.load()
            let locator = try CardLocator(url: url, configuration: configuration)
            try SharedState.defaults(configuration: configuration).set(try JSONEncoder().encode(locator), forKey: "pendingCard")
            hasPendingCard = true
        } catch {
            self.error = error.localizedDescription
        }
    }
}
