import XCTest

/// The host app's stored sign-in is only what the phone remembers. Each time the host app starts or comes back to the
/// foreground it asks the server whether that sign-in still stands, and the server's refusal ends it on the phone, host
/// app first: nobody has to open the extension or tap "Sign out" to find out. A check that merely failed ends nothing.
final class HostSessionJourneyTests: JourneyCase {
    /// How the gateway's call log names the host app.
    private let hostApp = "CalledItMessages"

    private func callsSince(_ start: Int) throws -> [[String: Any]] { Array(try control.calls().dropFirst(start)) }

    /// The outcomes of the host app's own session checks since a point in the call log, in order.
    private func checks(since start: Int) throws -> [String] {
        try callsSince(start).filter { $0["path"] as? String == "v0Auth:me" && $0["caller"] as? String == hostApp }.compactMap { $0["outcome"] as? String }
    }

    /// "Sign out" once the host app has finished checking the session and offers it for use again.
    private var usableSignOut: XCUIElement {
        host.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ AND enabled == YES", "auth.signOut")).firstMatch
    }

    /// The person leaves the host app for the home screen, without opening Messages.
    private func leaveTheHostApp(_ code: String) {
        XCUIDevice.shared.press(.home)
        let left = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.host.state != .runningForeground && self.host.state != .notRunning }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [left], timeout: 15 * Self.pace), .completed, "[\(code)] the host app went to the background and kept running")
    }

    /// Signs in and leaves the host app. The host app reads the notification preference once after a sign-in; that call
    /// is waited for, so the calls counted afterwards are only those the return to the app causes.
    private func signInAndLeave(_ actor: Actor, _ code: String) throws {
        try signIn(actor)
        eventually(code) { try self.appCalls("v0Notifications:preferences") >= 1 }
        leaveTheHostApp(code)
    }

    private func assertTheHostAppAsksForAPhoneNumber(_ code: String) throws {
        _ = try required("auth.phone", in: host, timeout: 30, code)
        assertGone(element("auth.signOut", in: host), code)
        XCTAssertFalse(element("auth.returnToMessages", in: host).exists, "[\(code)] the host app does not claim a sign-in")
        XCTAssertFalse(element("auth.code", in: host).exists, "[\(code)] no code is asked for before a phone number")
    }

    /// What the app asked the server after the sign-in ended there: the host app met the refusal on its own check, once,
    /// nothing was read with the dead sign-in, and the extension asked nothing at all.
    private func assertOnlyTheHostAppMetTheRefusal(since start: Int, _ code: String) throws {
        // The loopback backend can fail a call under load, with no code; the app repeats it and the failure is in the run's
        // evidence. So the refusal is the last answer and the only one with a code, within the app's two quiet repeats.
        let asked = try checks(since: start)
        XCTAssertEqual(asked.last, "AUTH_REQUIRED", "[\(code)] the server refused the host app's check: \(asked)")
        XCTAssertTrue(asked.count <= 3 && asked.dropLast().allSatisfy { $0 == "UNKNOWN" }, "[\(code)] the host app asked once, apart from attempts that failed with no answer: \(asked)")
        let later = try callsSince(start)
        XCTAssertEqual(later.filter { $0["outcome"] as? String == "success" }.count, 0, "[\(code)] nothing was read after the sign-in ended on the server")
        XCTAssertEqual(later.filter { $0["caller"] as? String != hostApp }.compactMap { $0["path"] as? String }, [], "[\(code)] only the host app called the server")
        XCTAssertEqual(try appCalls("v0Auth:revoke"), 0, "[\(code)] the app revoked nothing: it was told")
        XCTAssertEqual(try appCalls("v0Auth:verifyCode"), 1, "[\(code)] nothing signed in again by itself")
    }

    /// The extension, opened after the host app cleared the shared session, has no sign-in to ask the server with.
    private func assertTheExtensionAsksForASignIn(since start: Int, _ code: String) throws {
        try openExtension()
        // The extension's own sign-in control: one in the compact view, one on the full sign-in screen.
        let offer = messages.buttons.matching(NSPredicate(format: "label IN %@", ["Sign in with your phone", "Sign in with phone number"])).firstMatch
        XCTAssertTrue(offer.waitForExistence(timeout: 30 * Self.pace), "[\(code)] the extension asks for a sign-in")
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[\(code)] no group is shown without a sign-in")
        XCTAssertFalse(labelled("Link this conversation", in: messages, timeout: 0, quiet: true), "[\(code)] nothing to link without a sign-in")
        assertNoPrivateText(in: messages, code)
        let later = try callsSince(start)
        XCTAssertEqual(later.filter { $0["caller"] as? String == "CalledItExtension" }.compactMap { $0["path"] as? String }, [], "[\(code)] the extension found no session to call the server with")
        XCTAssertEqual(later.filter { $0["outcome"] as? String == "refused" }.count, 0, "[\(code)] no call outside the public policy inventory")
    }

    func testASignInRevokedElsewhereEndsInTheHostAppWhenItComesBackToTheForeground() throws {
        try signInAndLeave(.finn, "NATIVE-UI-HOSTCHECK-01")

        // Finn signs out of every device from somewhere else while this phone shows its home screen.
        let before = try control.calls().count
        XCTAssertNil(try control.act("finn", "mutation", "v0Auth:revoke", ["allDevices": true, "requestId": "revoke-everywhere"]), "[NATIVE-UI-HOSTCHECK-02] fixture: the revocation was refused")
        let sessions = try appSessions(.finn)
        XCTAssertEqual(sessions.count, 1, "[NATIVE-UI-HOSTCHECK-02] fixture: one sign-in on this phone")
        XCTAssertEqual(sessions.first?["revoked"] as? Bool, true, "[NATIVE-UI-HOSTCHECK-02] this phone's sign-in is revoked on the server")

        // The host app comes back without a relaunch. Nobody opens the extension and nobody taps "Sign out".
        host.activate()
        try assertTheHostAppAsksForAPhoneNumber("NATIVE-UI-HOSTCHECK-03")
        try assertOnlyTheHostAppMetTheRefusal(since: before, "NATIVE-UI-HOSTCHECK-04")

        try assertTheExtensionAsksForASignIn(since: before, "NATIVE-UI-HOSTCHECK-05")
    }

    func testASignInRevokedElsewhereEndsInTheHostAppAtAColdLaunchAndTheExtensionKeepsNothing() throws {
        try control.seedBet("bet-a", format: "this_that")
        try start(as: .finn)
        let row = try required("group.bet." + betID("bet-a"), in: messages, "NATIVE-UI-HOSTCOLD-01")
        XCTAssertTrue(row.label.contains(run.secretQuestion), "[NATIVE-UI-HOSTCOLD-01] the extension shows the group's question: \(row.label)")

        // The host app is closed, and Finn signs out of every device from somewhere else.
        host.terminate()
        let before = try control.calls().count
        XCTAssertNil(try control.act("finn", "mutation", "v0Auth:revoke", ["allDevices": true, "requestId": "revoke-everywhere"]), "[NATIVE-UI-HOSTCOLD-02] fixture: the revocation was refused")
        XCTAssertEqual(try appSessions(.finn).map { $0["revoked"] as? Bool }, [true], "[NATIVE-UI-HOSTCOLD-02] this phone's one sign-in is revoked on the server")

        // The host app is started again and reaches the phone sign-in by itself.
        host.launchEnvironment = run.launchEnvironment
        host.launch()
        try assertTheHostAppAsksForAPhoneNumber("NATIVE-UI-HOSTCOLD-03")
        try assertOnlyTheHostAppMetTheRefusal(since: before, "NATIVE-UI-HOSTCOLD-04")

        // The extension never met a refusal itself. It finds the shared session gone and shows nothing of the group.
        try assertTheExtensionAsksForASignIn(since: before, "NATIVE-UI-HOSTCOLD-05")
        XCTAssertFalse(element("group.bet." + (try betID("bet-a")), in: messages).exists, "[NATIVE-UI-HOSTCOLD-06] the bet is no longer listed")
        XCTAssertEqual(try appLinks().count, 0, "[NATIVE-UI-HOSTCOLD-07] the conversation link ended with the sign-in")
    }

    func testACheckThatOnlyFailsDoesNotSignThePersonOut() throws {
        try signInAndLeave(.finn, "NATIVE-UI-HOSTFAIL-01")

        // The server is overloaded when the host app comes back: its check fails with no code, also when repeated.
        var before = try control.calls().count
        try control.failNext("v0Auth:me", count: 3, caller: hostApp)
        host.activate()
        eventually("NATIVE-UI-HOSTFAIL-02", timeout: 30) { try self.checks(since: before).count == 3 }
        XCTAssertTrue(usableSignOut.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-HOSTFAIL-03] the check ended and the sign-in is still offered for use")
        XCTAssertEqual(try checks(since: before), ["injected", "injected", "injected"], "[NATIVE-UI-HOSTFAIL-03] three attempts, then the app stops by itself")
        _ = try required("auth.returnToMessages", in: host, "NATIVE-UI-HOSTFAIL-04")
        XCTAssertFalse(element("auth.phone", in: host).exists, "[NATIVE-UI-HOSTFAIL-04] a failed check does not ask for the phone number again")
        var sessions = try appSessions(.finn)
        XCTAssertEqual(sessions.count, 1, "[NATIVE-UI-HOSTFAIL-05] one sign-in")
        XCTAssertEqual(sessions.first?["revoked"] as? Bool, false, "[NATIVE-UI-HOSTFAIL-05] it is live on the server")
        XCTAssertEqual(try appCalls("v0Auth:revoke"), 0, "[NATIVE-UI-HOSTFAIL-05] the app revoked nothing")

        // The next time the host app comes back it asks again, and this time the server answers.
        leaveTheHostApp("NATIVE-UI-HOSTFAIL-06")
        before = try control.calls().count
        host.activate()
        eventually("NATIVE-UI-HOSTFAIL-07", timeout: 30) { try self.checks(since: before) == ["success"] }
        XCTAssertTrue(usableSignOut.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-HOSTFAIL-08] a sign-in the server accepts stays")
        XCTAssertFalse(element("auth.phone", in: host).exists, "[NATIVE-UI-HOSTFAIL-08]")

        // The shared session was never touched: the extension is signed in without a second code.
        try openExtension()
        _ = try labelled("Link this conversation", in: messages, timeout: 30)
        XCTAssertEqual(try appCalls("v0Auth:verifyCode"), 1, "[NATIVE-UI-HOSTFAIL-10] one sign-in, made once")
        sessions = try appSessions(.finn)
        XCTAssertEqual(sessions.map { $0["revoked"] as? Bool }, [false], "[NATIVE-UI-HOSTFAIL-10] still the one live sign-in")
    }

    func testAnExpiredSignInEndsInTheHostAppWhenItComesBackToTheForeground() throws {
        try signInAndLeave(.finn, "NATIVE-UI-HOSTEXPIRY-01")

        // The sign-in runs out on the server. Nobody signed out, and the phone's own copy still looks current.
        let before = try control.calls().count
        let expired = (try control.call("expireSessions", ["actor": "finn"]) as? [String: Any])?["expired"] as? Int
        XCTAssertEqual(expired, 1, "[NATIVE-UI-HOSTEXPIRY-02] the one app sign-in is past its expiry")
        let sessions = try appSessions(.finn)
        XCTAssertEqual(sessions.first?["expired"] as? Bool, true, "[NATIVE-UI-HOSTEXPIRY-02]")
        XCTAssertEqual(sessions.first?["revoked"] as? Bool, false, "[NATIVE-UI-HOSTEXPIRY-02] expired, not revoked")

        host.activate()
        try assertTheHostAppAsksForAPhoneNumber("NATIVE-UI-HOSTEXPIRY-03")
        try assertOnlyTheHostAppMetTheRefusal(since: before, "NATIVE-UI-HOSTEXPIRY-04")
        XCTAssertEqual(try appSessions(.finn).first?["revoked"] as? Bool, false, "[NATIVE-UI-HOSTEXPIRY-05] the sign-in expired; nothing revoked it")

        try assertTheExtensionAsksForASignIn(since: before, "NATIVE-UI-HOSTEXPIRY-06")
    }
}
