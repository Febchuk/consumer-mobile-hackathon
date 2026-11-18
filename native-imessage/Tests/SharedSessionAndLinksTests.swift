import XCTest

final class SharedSessionAndLinksTests: XCTestCase {
    func testSessionRequiresStableAccountTokenEnvironmentAndStrictExpiry() throws {
        let fixture = NativeUnitFixture()
        let configuration = try fixture.configuration()
        let date = Date(timeIntervalSince1970: fixture.serverTime / 1000)
        let valid = SharedSession(accountID: fixture.namespace + "_friend", token: "SYNTHETIC_UNIT_TOKEN", expiresAt: fixture.serverTime + 1, environmentID: "staging")
        XCTAssertTrue(valid.isUsable(in: configuration, at: date), "[NATIVE-SESSION-01]")
        for invalid in [
            SharedSession(accountID: "", token: valid.token, expiresAt: valid.expiresAt, environmentID: "staging"),
            SharedSession(accountID: valid.accountID, token: "", expiresAt: valid.expiresAt, environmentID: "staging"),
            SharedSession(accountID: valid.accountID, token: valid.token, expiresAt: valid.expiresAt, environmentID: "production"),
            SharedSession(accountID: valid.accountID, token: valid.token, expiresAt: fixture.serverTime, environmentID: "staging"),
            SharedSession(accountID: valid.accountID, token: valid.token, expiresAt: .infinity, environmentID: "staging"),
            SharedSession(accountID: valid.accountID, token: valid.token, expiresAt: .nan, environmentID: "staging")
        ] {
            XCTAssertFalse(invalid.isUsable(in: configuration, at: date), "[NATIVE-SESSION-02] unusable session must never authorize local state")
        }
    }

    func testClearAccountDropsOnlyThatAccountsPrivateRoutingAndPendingLocators() throws {
        let fixture = NativeUnitFixture()
        let configuration = try fixture.configuration()
        let defaults = try SharedState.defaults(configuration: configuration)
        defer { defaults.removePersistentDomain(forName: configuration.appGroup) }
        let linkKey = "links." + configuration.storageNamespace + ".friend"
        let otherLinkKey = "links." + configuration.storageNamespace + ".outsider"
        defaults.set(["chat": "g1"], forKey: linkKey)
        defaults.set(["chat": "g2"], forKey: otherLinkKey)
        let revealKey = "reveals." + configuration.storageNamespace + ".friend"
        let otherRevealKey = "reveals." + configuration.storageNamespace + ".outsider"
        let pendingKeys = [configuration.storageKey("pendingCard"), configuration.storageKey("pendingNotification")]
        defaults.set(["b1": true], forKey: revealKey)
        defaults.set(["b2": true], forKey: otherRevealKey)
        for key in pendingKeys { defaults.set(Data("synthetic".utf8), forKey: key) }
        try SharedState.clearAccount("friend", configuration: configuration)
        XCTAssertNil(defaults.object(forKey: linkKey), "[NATIVE-CLEAR-01] link map left by an earlier build is removed")
        XCTAssertEqual(defaults.dictionary(forKey: otherLinkKey) as? [String: String], ["chat": "g2"], "[NATIVE-CLEAR-02]")
        for key in [revealKey] + pendingKeys {
            XCTAssertNil(defaults.object(forKey: key), "[NATIVE-CLEAR-03] stale private routing removed")
        }
        XCTAssertNotNil(defaults.object(forKey: otherRevealKey), "[NATIVE-CLEAR-04] another account's reveal state remains")
    }
}
