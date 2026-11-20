import Foundation

struct PhoneChallenge {
    let id: String
    let maskedPhone: String
    let phone: String
}

protocol PhoneAuthenticating {
    func requestCode(phone: String) async throws -> PhoneChallenge
    func verifyCode(challenge: PhoneChallenge, code: String) async throws -> SharedSession
    func revoke(session: SharedSession) async throws
    /// Throws AUTH_REQUIRED when the server no longer accepts this sign-in.
    func confirm(session: SharedSession) async throws
}

struct VerifiedPhoneAuthentication: PhoneAuthenticating {
    private struct Started: Decodable { let requestId: String; let expiresAt: Double }
    private struct Account: Decodable { let id: String; let displayName: String }
    private struct Verified: Decodable { let token: String; let expiresAt: Double; let account: Account }

    func requestCode(phone: String) async throws -> PhoneChallenge {
        guard let result: Started = try await API.action("v0Auth:requestCode", ["phone": phone, "requestId": UUID().uuidString]) else {
            throw NativeError.unavailable
        }
        return PhoneChallenge(id: result.requestId, maskedPhone: "••• " + phone.suffix(4), phone: phone)
    }

    func verifyCode(challenge: PhoneChallenge, code: String) async throws -> SharedSession {
        let configuration = try Config.load()
        let defaults = try SharedState.defaults(configuration: configuration)
        let deviceID = defaults.string(forKey: configuration.storageKey("deviceID")) ?? UUID().uuidString
        defaults.set(deviceID, forKey: configuration.storageKey("deviceID"))
        guard let result: Verified = try await API.action("v0Auth:verifyCode", [
            "phone": challenge.phone, "code": code, "requestId": challenge.id, "deviceId": deviceID,
        ]) else { throw NativeError.unavailable }
        return SharedSession(accountID: result.account.id, token: result.token, expiresAt: result.expiresAt, environmentID: configuration.environmentID)
    }

    func revoke(session: SharedSession) async throws {
        let _: Ignored? = try await API.mutation("v0Auth:revoke", ["token": session.token, "allDevices": false, "requestId": UUID().uuidString])
    }

    /// The same question the extension asks on every load, with the same reading of the answer.
    func confirm(session: SharedSession) async throws {
        let result: AccountSnapshot? = try await API.query("v0Auth:me", ["token": session.token])
        guard result?.account.id == session.accountID else { throw APIError(code: "AUTH_REQUIRED") }
    }
}
