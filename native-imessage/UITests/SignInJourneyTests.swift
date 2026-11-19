import XCTest

/// Journey 2: one phone sign-in in the host app, shared with the extension, and nothing private without it.
final class SignInJourneyTests: JourneyCase {
    func testAWrongCodeIsRefusedAndTheRightCodeSignsInOnce() throws {
        let phone = try launchHostSignedOut()
        phone.tap()
        try enter(Actor.finn.phone, into: phone, called: "auth.phone")
        try tap("auth.requestCode", in: host)
        let code = try required("auth.code", in: host, "NATIVE-UI-CODE-01")
        code.tap()
        try enter("111111", into: code, called: "auth.code")
        try tap("auth.verify", in: host)
        // The error is the last row of the form and can be below the fold once the keyboard is away.
        if !element("auth.error", in: host).waitForExistence(timeout: 10 * Self.pace) { host.swipeUp() }
        _ = try required("auth.error", in: host, "NATIVE-UI-CODE-02")
        XCTAssertFalse(element("auth.returnToMessages", in: host).exists, "[NATIVE-UI-CODE-02] a wrong code does not sign in")
        XCTAssertEqual(try appSessions(.finn).count, 0, "[NATIVE-UI-CODE-03] no session after a wrong code")
        XCTAssertEqual(try appCalls("v0Auth:verifyCode"), 0, "[NATIVE-UI-CODE-03]")

        // The person can correct the code without starting over.
        if !element("auth.code", in: host).exists { host.swipeDown() }
        let again = try required("auth.code", in: host, "NATIVE-UI-CODE-04")
        again.tap()
        clear(again)
        try enter("000000", into: again, called: "auth.code")
        try tap("auth.verify", in: host)
        _ = try required("auth.returnToMessages", in: host, "NATIVE-UI-CODE-05")
        XCTAssertFalse(element("auth.error", in: host).exists, "[NATIVE-UI-CODE-05] the earlier error is gone")
        XCTAssertEqual(try appSessions(.finn).count, 1, "[NATIVE-UI-CODE-06] exactly one session")
        XCTAssertEqual(try appCalls("v0Auth:requestCode"), 1, "[NATIVE-UI-CODE-06] one code request, no second challenge")

        // The same sign-in works in the extension: no second code, no pairing, no profile step.
        try openExtension()
        _ = try labelled("Link this conversation", in: messages)
        XCTAssertEqual(try appCalls("v0Auth:verifyCode"), 1, "[NATIVE-UI-CODE-07] the extension did not sign in again")
        XCTAssertEqual(try appSessions(.finn).count, 1, "[NATIVE-UI-CODE-07] still one session, shared by the host app and the extension")
    }

    func testASignedOutExtensionShowsNothingPrivate() throws {
        try control.seedBet("bet-a", format: "this_that")
        _ = try launchHostSignedOut()
        try openExtension()
        _ = try labelled("Sign in with your phone", in: messages)
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-SIGNEDOUT-01] no group without a sign-in")
        XCTAssertFalse(labelled("Link this conversation", in: messages, timeout: 0, quiet: true), "[NATIVE-UI-SIGNEDOUT-01] nothing to link without a sign-in")
        assertNoPrivateText(in: messages, "NATIVE-UI-SIGNEDOUT-02")
        let allowed: Set<String> = ["v0Notifications:preferences", "v0Auth:revoke"]
        let asked = try control.calls().filter { $0["outcome"] as? String == "success" && !allowed.contains($0["path"] as? String ?? "") }
        XCTAssertEqual(asked.count, 0, "[NATIVE-UI-SIGNEDOUT-03] no data was read without a sign-in")
    }

    func testSwitchingAccountsShowsOnlyTheNewPersonsGroups() throws {
        try control.seedBet("bet-a", format: "this_that")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.question", in: screen), run.secretQuestion, "NATIVE-UI-SWITCH-01")

        // Finn signs out in the host app and Oli, who is not in G1, signs in on the same phone.
        try signIn(.oli)
        XCTAssertTrue(try appSessions(.finn).allSatisfy { $0["revoked"] as? Bool == true }, "[NATIVE-UI-SWITCH-02] Finn's sign-in is revoked")

        // Messages is brought back without a relaunch, in the same conversation Finn linked. Messages closes an extension when it
        // leaves the foreground, so Oli opens Called It again the way a person would.
        XCTAssertTrue([.runningBackground, .runningBackgroundSuspended].contains(messages.state), "[NATIVE-UI-SWITCH-06] Messages is still running from Finn's visit, state \(messages.state.rawValue)")
        messages.activate()
        XCTAssertTrue(messages.wait(for: .runningForeground, timeout: 60 * Self.pace), "[NATIVE-UI-SWITCH-06] Messages returns to the foreground without a relaunch")
        // A system onboarding sheet can cover Messages when it returns; a person would dismiss it.
        let sheet = messages.buttons.matching(NSPredicate(format: "label IN %@", ["OK", "Continue"])).firstMatch
        while sheet.waitForExistence(timeout: 4 * Self.pace) { sheet.tap() }
        assertLabel(try required("ConversationTitle", in: messages), Self.conversations[0], "NATIVE-UI-SWITCH-06")
        if !element("navigation.settings", in: messages).exists {
            try tap(labelled("add", in: messages))
            try tap(labelled("Called It", .cell, in: messages))
        }
        // The absence checks only count while the extension itself is on screen.
        _ = try required("navigation.settings", in: messages, timeout: 30, "NATIVE-UI-SWITCH-06")
        XCTAssertFalse(element("bet.question", in: messages).exists, "[NATIVE-UI-SWITCH-06] Finn's open bet is not shown to Oli")
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-SWITCH-06] Finn's link to the group does not carry over to Oli")
        assertNoPrivateText(in: messages, "NATIVE-UI-SWITCH-06")
        try tap(labelled("Link this conversation", in: messages))
        _ = try required("group.link." + groupID("G2"), in: messages, "NATIVE-UI-SWITCH-03")
        XCTAssertFalse(element("group.link." + (try groupID("G1")), in: messages).exists, "[NATIVE-UI-SWITCH-04] the previous person's group is not offered")
        XCTAssertFalse(element("group.bet." + (try betID("bet-a")), in: messages).exists, "[NATIVE-UI-SWITCH-04]")
        assertNoPrivateText(in: messages, "NATIVE-UI-SWITCH-05")
    }
}
