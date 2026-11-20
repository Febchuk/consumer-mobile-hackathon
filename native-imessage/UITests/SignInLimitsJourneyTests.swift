import XCTest

/// SEC2 on the real sign-in screen: an expired code, the limit on wrong codes, and the same phone landing on the same
/// account. Kept apart from SecurityJourneyTests so each class fits a shard of the hosted run.
final class SignInLimitsJourneyTests: JourneyCase {
    private func standing(_ alias: String, points: Int) -> String {
        "You're \(alias) \u{00B7} \(points) group points \u{00B7} streak 0"
    }

    private func memberships(_ actor: Actor, in group: String) throws -> [[String: Any]] {
        try control.rows("memberships").filter { $0["actor"] as? String == actor.rawValue && $0["group"] as? String == group }
    }

    private func providerCount(_ name: String) throws -> Int {
        guard let count = (try control.inspect()["provider"] as? [String: Any])?[name] as? Int else {
            XCTFail("[NATIVE-UI-SEC-FIXTURE] the fake code provider reported no \(name)")
            throw Blocked()
        }
        return count
    }

    /// The gateway forwards only the functions named in the public policy inventory and logs any other call as refused.
    private func assertTheAppCalledOnlyInventoriedFunctions(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let calls = try control.calls()
        XCTAssertFalse(calls.isEmpty, "[\(code)] the app made no call, so this check would mean nothing", file: file, line: line)
        let refused = calls.filter { $0["outcome"] as? String == "refused" }.compactMap { $0["path"] as? String }
        XCTAssertEqual(refused, [], "[\(code)] the app called a function the public policy inventory does not name", file: file, line: line)
    }

    /// Reaches the list of groups in a conversation that is not linked. Messages can bring the extension back small, where
    /// one button leads to the list, or at full height, where an unlinked conversation shows the list at once.
    private func openGroups(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let small = messages.buttons.matching(NSPredicate(format: "label == %@", "Link this conversation")).firstMatch
        let list = text("Your groups", in: messages)
        let reached = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in small.exists || list.exists }, object: nil)
        guard XCTWaiter.wait(for: [reached], timeout: 30 * Self.pace) == .completed else {
            XCTFail("[\(code)] an unlinked conversation offered neither the link button nor the list of groups", file: file, line: line)
            throw Blocked()
        }
        if !list.exists { try tap(small, file: file, line: line) }
        XCTAssertTrue(list.waitForExistence(timeout: 20 * Self.pace), "[\(code)] the list of groups did not open", file: file, line: line)
    }

    /// The sign-in error is the last row of the host app's form and can be below the fold once the keyboard is away.
    private func signInError(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        if !element("auth.error", in: host).waitForExistence(timeout: 10 * Self.pace) { host.swipeUp() }
        return try required("auth.error", in: host, code, file: file, line: line)
    }

    /// Puts the cursor back in the code field after a refused code, the way the sign-in journey does.
    private func refocusCode(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        if !element("auth.code", in: host).exists { host.swipeDown() }
        let field = try required("auth.code", in: host, code, file: file, line: line)
        try tap(field, scrolling: host, file: file, line: line)
        // After the scroll the field can sit under the navigation bar, where a tap does not reach it.
        let keyboard = host.keyboards.firstMatch
        if !keyboard.waitForExistence(timeout: 5 * Self.pace) {
            host.swipeDown()
            try tap(field, scrolling: host, file: file, line: line)
        }
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10 * Self.pace), "[\(code)] the code field takes the keyboard again", file: file, line: line)
        return field
    }

    /// Asks for a code for one fixture phone on the host app's sign-in screen and returns the code field.
    private func requestCode(for actor: Actor, _ code: String) throws -> XCUIElement {
        let phone = try launchHostSignedOut()
        phone.tap()
        try enter(actor.phone, into: phone, called: "auth.phone")
        try tap("auth.requestCode", in: host)
        let field = try required("auth.code", in: host, timeout: 15, code)
        field.tap()
        return field
    }

    /// The product sends one code to a phone every 30 seconds. A second sign-in for the same phone inside one test waits
    /// for that window to pass, measured from the moment the gateway logged the first request.
    private func waitUntilAnotherCodeCanBeSent(_ code: String) throws {
        guard let asked = try control.calls().last(where: { $0["path"] as? String == "v0Auth:requestCode" && $0["outcome"] as? String == "success" })?["at"] as? Double else {
            XCTFail("[\(code)] no earlier code request is on record")
            throw Blocked()
        }
        eventually(code, timeout: 45) { Date().timeIntervalSince1970 * 1000 - asked > 31_000 }
    }

    func testSigningInAgainByPhoneLandsOnTheSameAccount() throws {
        try control.reset(points: ["G1": ["finn": 210], "G2": ["finn": 35]])
        try start(as: .finn)
        assertText(standing(Actor.finn.alias, points: 210), in: messages, "NATIVE-UI-STABLE-01")
        XCTAssertEqual(try appSessions(.finn).count, 1, "[NATIVE-UI-STABLE-02] one sign-in")
        XCTAssertEqual(try appLinks().count, 1, "[NATIVE-UI-STABLE-02] this conversation is linked for this sign-in")

        // Finn signs out in the host app and signs in again with the same phone number.
        try waitUntilAnotherCodeCanBeSent("NATIVE-UI-STABLE-03")
        try signIn(.finn)
        let sessions = try appSessions(.finn)
        XCTAssertEqual(sessions.count, 2, "[NATIVE-UI-STABLE-04] a second sign-in for the same person")
        XCTAssertEqual(sessions.filter { $0["revoked"] as? Bool == true }.count, 1, "[NATIVE-UI-STABLE-04] the first sign-in is revoked and the second is live")
        let accounts = try control.rows("accountRows")
        XCTAssertEqual(accounts.count, 4, "[NATIVE-UI-STABLE-05] verifying a known phone creates no account")
        XCTAssertEqual(Set(accounts.compactMap { $0["displayName"] as? String }), Set([Actor.cora, .finn, .sage, .oli].map(\.alias)), "[NATIVE-UI-STABLE-05]")
        XCTAssertEqual(try appCalls("v0Auth:requestCode"), 2, "[NATIVE-UI-STABLE-05] each sign-in took its own code")
        XCTAssertEqual(try appLinks().count, 0, "[NATIVE-UI-STABLE-06] the first sign-in's conversation link ended with it")

        // The same account comes back: both groups, the same name and the same points. The conversation is linked again
        // only by choosing it.
        try openExtension()
        try openGroups("NATIVE-UI-STABLE-07")
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-STABLE-07] no group is assumed for the new sign-in")
        _ = try required("group.link." + groupID("G2"), in: messages, "NATIVE-UI-STABLE-08")
        try tap("group.link." + groupID("G1"), in: messages)
        _ = try required("navigation.board", in: messages, timeout: 15, "NATIVE-UI-STABLE-09")
        assertText(standing(Actor.finn.alias, points: 210), in: messages, "NATIVE-UI-STABLE-09")
        let rows = try control.rows("memberships").filter { $0["actor"] as? String == "finn" }
        XCTAssertEqual(rows.count, 2, "[NATIVE-UI-STABLE-10] no membership was added or ended")
        XCTAssertTrue(rows.allSatisfy { $0["left"] as? Bool != true }, "[NATIVE-UI-STABLE-10]")
        XCTAssertEqual(try memberships(.finn, in: "G1").first?["points"] as? Int, 210, "[NATIVE-UI-STABLE-10]")
        try assertTheAppCalledOnlyInventoriedFunctions("NATIVE-UI-STABLE-11")
    }

    func testAnExpiredCodeIsRefusedEvenWhenItIsTheRightCode() throws {
        let code = try requestCode(for: .sage, "NATIVE-UI-EXPIRED-01")
        let checks = try providerCount("checks")
        // The code's ten minutes pass: the fixture moves the stored challenge past its expiry, as it moves a bet to its reveal.
        XCTAssertEqual((try control.call("expireCodes") as? [String: Any])?["expired"] as? Int, 1, "[NATIVE-UI-EXPIRED-02] fixture: exactly one code was waiting")
        try enter("000000", into: code, called: "auth.code")
        try tap("auth.verify", in: host)
        eventually("NATIVE-UI-EXPIRED-03") { try self.appCalls("v0Auth:verifyCode", outcome: "INVALID_INPUT") == 1 }
        assertLabel(try signInError("NATIVE-UI-EXPIRED-04"), "Check your entries and try again.", "NATIVE-UI-EXPIRED-04")
        XCTAssertFalse(element("auth.returnToMessages", in: host).exists, "[NATIVE-UI-EXPIRED-05] an expired code does not sign in")
        XCTAssertEqual(try appSessions(.sage).count, 0, "[NATIVE-UI-EXPIRED-05] no session after an expired code")
        XCTAssertEqual(try appCalls("v0Auth:verifyCode"), 0, "[NATIVE-UI-EXPIRED-05]")
        XCTAssertEqual(try providerCount("checks"), checks, "[NATIVE-UI-EXPIRED-06] the server refused the expired code without asking the code provider")
        let stored = try control.rows("codes")
        XCTAssertEqual(stored.count, 1, "[NATIVE-UI-EXPIRED-07]")
        XCTAssertEqual(stored.first?["consumed"] as? Bool, false, "[NATIVE-UI-EXPIRED-07] the expired code was not used up as a sign-in")
        XCTAssertEqual(stored.first?["attempts"] as? Int, 0, "[NATIVE-UI-EXPIRED-07]")
    }

    func testFiveWrongCodesCloseTheChallengeEvenForTheRightCode() throws {
        var code = try requestCode(for: .oli, "NATIVE-UI-ATTEMPTS-01")
        let checks = try providerCount("checks"), invalid = try providerCount("invalidCodes")
        for attempt in 1...5 {
            if attempt > 1 {
                code = try refocusCode("NATIVE-UI-ATTEMPTS-02")
                clear(code)
            }
            try enter(String(repeating: String(attempt), count: 6), into: code, called: "auth.code")
            try tap("auth.verify", in: host)
            eventually("NATIVE-UI-ATTEMPTS-02") { try self.appCalls("v0Auth:verifyCode", outcome: "INVALID_INPUT") == attempt }
        }
        assertLabel(try signInError("NATIVE-UI-ATTEMPTS-03"), "Check your entries and try again.", "NATIVE-UI-ATTEMPTS-03")
        XCTAssertEqual(try appSessions(.oli).count, 0, "[NATIVE-UI-ATTEMPTS-03] no session after five wrong codes")
        XCTAssertEqual(try control.rows("codes").first?["attempts"] as? Int, 5, "[NATIVE-UI-ATTEMPTS-03] the server counted each wrong code")

        // The sixth try is the right code, and it is refused: the challenge is closed.
        code = try refocusCode("NATIVE-UI-ATTEMPTS-04")
        clear(code)
        try enter("000000", into: code, called: "auth.code")
        try tap("auth.verify", in: host)
        eventually("NATIVE-UI-ATTEMPTS-04") { try self.appCalls("v0Auth:verifyCode", outcome: "RATE_LIMITED") == 1 }
        assertLabel(try signInError("NATIVE-UI-ATTEMPTS-05"), "Please wait before trying again.", "NATIVE-UI-ATTEMPTS-05")
        XCTAssertFalse(element("auth.returnToMessages", in: host).exists, "[NATIVE-UI-ATTEMPTS-06] the right code does not sign in once the challenge is closed")
        XCTAssertEqual(try appSessions(.oli).count, 0, "[NATIVE-UI-ATTEMPTS-06]")
        XCTAssertEqual(try appCalls("v0Auth:verifyCode"), 0, "[NATIVE-UI-ATTEMPTS-06]")
        XCTAssertEqual(try providerCount("checks") - checks, 5, "[NATIVE-UI-ATTEMPTS-07] the sixth try never reached the code provider")
        XCTAssertEqual(try providerCount("invalidCodes") - invalid, 5, "[NATIVE-UI-ATTEMPTS-07]")
        let stored = try control.rows("codes")
        XCTAssertEqual(stored.count, 1, "[NATIVE-UI-ATTEMPTS-08] one code was sent")
        XCTAssertEqual(stored.first?["attempts"] as? Int, 5, "[NATIVE-UI-ATTEMPTS-08] the count stops at five")
        XCTAssertEqual(stored.first?["consumed"] as? Bool, false, "[NATIVE-UI-ATTEMPTS-08]")
        XCTAssertEqual(try appCalls("v0Auth:requestCode"), 1, "[NATIVE-UI-ATTEMPTS-08]")
    }
}
