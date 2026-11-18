import XCTest

/// Journey 8: the controls a person has over bets about them, their groups and their account.
final class ControlsJourneyTests: JourneyCase {
    private func openSettings() throws {
        try tap("navigation.settings", in: messages)
        _ = try required("settings.noBets", in: messages, timeout: 15, "NATIVE-UI-SETTINGS")
    }

    func testEveryControlIsOneTapFromHome() throws {
        try start(as: .sage)
        try tap("navigation.settings", in: messages)
        for id in ["settings.noBets", "settings.topics", "settings.reportReason", "settings.report", "settings.blockUser", "settings.leave", "settings.signOut", "settings.delete"] {
            _ = try required(id, in: messages, timeout: 15, "NATIVE-UI-CONTROLS-01")
        }
        assertText("V0 reads no chats, contacts or photo library. Suggestions use templates, eligible group history and context you choose to type.", in: messages, "NATIVE-UI-CONTROLS-02")
    }

    func testNoBetsAboutMeCancelsOpenBetsAndRefusesNewOnes() throws {
        try control.seedBet("bet-a", format: "yes_no")
        try start(as: .sage)
        try openSettings()
        let toggle = try required("settings.noBets", in: messages)
        XCTAssertEqual(toggle.value as? String, "0", "[NATIVE-UI-NOBETS-01] off to begin with")
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        assertLabel(try required("settings.result", in: messages, timeout: 15, "NATIVE-UI-NOBETS-02"), "Privacy settings saved.", "NATIVE-UI-NOBETS-02")
        XCTAssertEqual(toggle.value as? String, "1", "[NATIVE-UI-NOBETS-02] the switch shows the saved state")
        XCTAssertEqual(try control.rows("accountRows").first { $0["actor"] as? String == "sage" }?["noBets"] as? Bool, true, "[NATIVE-UI-NOBETS-03] saved on the server")
        XCTAssertEqual(try bet("bet-a")["state"] as? String, "voided", "[NATIVE-UI-NOBETS-04] the open bet about Sage is cancelled")

        let reveal = Date().timeIntervalSince1970 * 1000 + 3 * 3_600_000
        let refused = try control.act("cora", "mutation", "v0Bets:create", [
            "groupId": "@G1", "subjectId": "@sage", "question": "A new bet about Sage", "contextLine": "", "format": "yes_no", "options": ["Yes", "No"],
            "cutoffAt": reveal, "revealAt": reveal, "source": "manual", "requestId": "after-no-bets",
        ])
        XCTAssertNotNil(refused, "[NATIVE-UI-NOBETS-05] the server refuses a new bet about Sage")
        XCTAssertEqual(try control.rows("bets").count, 1, "[NATIVE-UI-NOBETS-05]")
    }

    func testLeavingOneGroupVoidsOpenPicksAndKeepsTheOther() throws {
        try control.seedBet("bet-a", format: "yes_no")
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 0, "confidence": 0.8, "requestId": "finn-pick"]))
        try start(as: .finn)
        try openSettings()
        try tap("settings.leave", in: messages)
        XCTAssertFalse(try control.rows("memberships").contains { $0["actor"] as? String == "finn" && $0["left"] as? Bool == true }, "[NATIVE-UI-LEAVE-01] nothing happens before the confirmation")
        try tap(labelled("Leave group", in: messages))
        assertText("Your groups", in: messages, "NATIVE-UI-LEAVE-02", timeout: 15)
        let memberships = try control.rows("memberships").filter { $0["actor"] as? String == "finn" }
        XCTAssertEqual(memberships.first { $0["group"] as? String == "G1" }?["left"] as? Bool, true, "[NATIVE-UI-LEAVE-03]")
        XCTAssertEqual(memberships.first { $0["group"] as? String == "G2" }?["left"] as? Bool, false, "[NATIVE-UI-LEAVE-04] the other group is untouched")
        XCTAssertEqual(try control.rows("picks").first?["voided"] as? Bool, true, "[NATIVE-UI-LEAVE-05] the open pick is voided")
        XCTAssertFalse(element("group.link." + (try groupID("G1")), in: messages).exists, "[NATIVE-UI-LEAVE-06] the group left is no longer offered")
        _ = try required("group.link." + groupID("G2"), in: messages, "NATIVE-UI-LEAVE-06")
        assertNoPrivateText(in: messages, "NATIVE-UI-LEAVE-07")
    }

    func testDeletingTheAccountRevokesEverySignIn() throws {
        try start(as: .oli, in: "G2")
        try openSettings()
        try tap("settings.delete", in: messages)
        XCTAssertEqual(try control.rows("accountRows").first { $0["actor"] as? String == "oli" }?["deleted"] as? Bool, false, "[NATIVE-UI-DELETE-01] nothing happens before the confirmation")
        try tap(labelled("Delete account and data", in: messages))
        _ = try labelled("Sign in with phone number", in: messages, timeout: 20)
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-DELETE-02] no group is shown after deletion")
        let caveat = messages.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Called It cannot erase cards or copies already received in other people's Messages.")).firstMatch
        XCTAssertTrue(caveat.waitForExistence(timeout: 10), "[NATIVE-UI-DELETE-02] the person is told that copies already sent cannot be erased")
        // Deletion removes the phone number, so the fixture can no longer name the row as Oli.
        let accounts = try control.rows("accountRows")
        XCTAssertFalse(accounts.contains { $0["actor"] as? String == "oli" }, "[NATIVE-UI-DELETE-03] the phone number no longer leads to an account")
        let removed = accounts.filter { $0["deleted"] as? Bool == true }
        XCTAssertEqual(removed.count, 1, "[NATIVE-UI-DELETE-03] exactly one account is deleted")
        XCTAssertEqual(removed.first?["displayName"] as? String, "Deleted account", "[NATIVE-UI-DELETE-03] the name is removed")
        let sessions = try control.rows("sessions").filter { !["cora", "finn", "sage"].contains($0["actor"] as? String ?? "") }
        XCTAssertTrue(sessions.allSatisfy { $0["revoked"] as? Bool == true }, "[NATIVE-UI-DELETE-04] every sign-in of the deleted account is revoked")
        XCTAssertFalse(try control.rows("memberships").contains { $0["actor"] as? String == "oli" && $0["left"] as? Bool != true }, "[NATIVE-UI-DELETE-04] no active membership remains")
        XCTAssertEqual(try appCalls("v0Controls:deleteAccount"), 1, "[NATIVE-UI-DELETE-05]")
    }

    func testAReportAndABlockAreRecorded() throws {
        try start(as: .cora)
        try openSettings()
        try type("Synthetic safety report", into: "settings.reportReason")
        try tap("settings.report", in: messages)
        eventually("NATIVE-UI-REPORT-01") { try self.control.rows("reports").count == 1 }
        let report = try control.rows("reports").first
        XCTAssertEqual(report?["reporter"] as? String, "cora", "[NATIVE-UI-REPORT-01]")
        XCTAssertEqual(report?["group"] as? String, "G1", "[NATIVE-UI-REPORT-01]")
        XCTAssertEqual(report?["reason"] as? String, "Synthetic safety report", "[NATIVE-UI-REPORT-01]")

        try chooseMenu("settings.blockUser", "QA Finn")
        try tap(labelled("Block selected user", in: messages))
        eventually("NATIVE-UI-BLOCK-01") { try self.control.rows("blocks").count == 1 }
        let block = try control.rows("blocks").first
        XCTAssertEqual(block?["actor"] as? String, "cora", "[NATIVE-UI-BLOCK-01]")
        XCTAssertEqual(block?["blocked"] as? String, "finn", "[NATIVE-UI-BLOCK-01]")
    }

    func testSigningOutClearsWhatThePreviousViewerSaw() throws {
        try control.seedBet("bet-a", format: "this_that")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.question", in: screen), run.secretQuestion, "NATIVE-UI-SIGNOUT-01")
        try tap("navigation.settings", in: messages)
        try tap("settings.signOut", in: messages)
        _ = try labelled("Sign in with phone number", in: messages, timeout: 20)
        try assertNoPrivateContent(in: messages, anchor: "Sign in to Called It", "NATIVE-UI-SIGNOUT-02")
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-SIGNOUT-03] no group is shown when signed out")
        let sessions = try control.rows("sessions").filter { $0["actor"] as? String == "finn" && $0["control"] as? Bool != true }
        XCTAssertTrue(!sessions.isEmpty && sessions.allSatisfy { $0["revoked"] as? Bool == true }, "[NATIVE-UI-SIGNOUT-04] the sign-in is revoked on the server")
    }
}
