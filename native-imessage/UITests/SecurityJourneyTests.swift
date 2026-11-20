import XCTest

/// SEC1 to SEC3 on the real screens: what each kind of person is shown, how a revoked sign-in ends, and what a
/// locked card gives away. The backend contracts themselves are proven by the backend tests; these tests prove the app
/// shows what those contracts allow and nothing more.
final class SecurityJourneyTests: JourneyCase {
    private let notAvailable = "This isn't available to your account. An earlier card may be outside your membership."
    private let noBets = "No available bets since you joined. Earlier cards stay unavailable, including after rejoining."

    private var acceptInvitation: XCUIElement {
        messages.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "group.accept.")).firstMatch
    }

    private func standing(_ alias: String, points: Int) -> String {
        "You're \(alias) \u{00B7} \(points) group points \u{00B7} streak 0"
    }

    /// How many elements on screen carry this text in their label or value.
    private func shown(_ fragment: String, in container: XCUIElement) -> Int {
        container.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", fragment, fragment)).count
    }

    private func pick(_ actor: Actor, option: Int, confidence: Double) throws {
        XCTAssertNil(try control.act(actor.rawValue, "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": option, "confidence": confidence, "requestId": actor.rawValue + "-pick"]), "[NATIVE-UI-SEC-FIXTURE] \(actor.rawValue)'s pick was refused")
    }

    private func memberships(_ actor: Actor, in group: String) throws -> [[String: Any]] {
        try control.rows("memberships").filter { $0["actor"] as? String == actor.rawValue && $0["group"] as? String == group }
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

    // MARK: SEC1 - who can read what

    func testPeopleOutsideTheGroupAreShownNothingOfItUnderAnyName() throws {
        try control.seedBet("bet-a", format: "this_that")
        try pick(.finn, option: 0, confidence: 0.8)
        // Oli, who is only in G2, takes the name of the person the bet is about. A name is not an identity.
        XCTAssertNil(try control.act("oli", "mutation", "v0Controls:alias", ["groupId": "@G2", "alias": Actor.sage.alias, "requestId": "oli-takes-a-name"]), "[NATIVE-UI-OUTSIDE-00] fixture: the rename was refused")

        // Nobody is signed in.
        _ = try launchHostSignedOut()
        try openExtension()
        _ = try labelled("Sign in with your phone", in: messages)
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-OUTSIDE-01] no group without a sign-in")
        assertNoPrivateText(in: messages, "NATIVE-UI-OUTSIDE-02")
        let allowed: Set<String> = ["v0Notifications:preferences", "v0Auth:revoke"]
        let read = try control.calls().filter { $0["outcome"] as? String == "success" && !allowed.contains($0["path"] as? String ?? "") }
        XCTAssertEqual(read.count, 0, "[NATIVE-UI-OUTSIDE-03] nothing was read without a sign-in")

        // Oli signs in with Oli's own phone and carries Sage's name.
        try signIn(.oli)
        try openExtension()
        try openGroups("NATIVE-UI-OUTSIDE-04")
        let first = try groupID("G1"), second = try groupID("G2"), hidden = try betID("bet-a")
        _ = try required("group.link." + second, in: messages, "NATIVE-UI-OUTSIDE-04")
        XCTAssertFalse(element("group.link." + first, in: messages).exists, "[NATIVE-UI-OUTSIDE-05] the name gives no way into a group Oli is not in")
        assertText("No pending invitations.", in: messages, "NATIVE-UI-OUTSIDE-05")
        XCTAssertFalse(acceptInvitation.exists, "[NATIVE-UI-OUTSIDE-05] nothing to accept without an invitation to Oli's own phone")
        try tap("group.link." + second, in: messages)
        _ = try required("navigation.board", in: messages, timeout: 15, "NATIVE-UI-OUTSIDE-06")
        assertText(standing(Actor.sage.alias, points: 0), in: messages, "NATIVE-UI-OUTSIDE-06")
        assertText(noBets, in: messages, "NATIVE-UI-OUTSIDE-07")
        XCTAssertFalse(element("group.bet." + hidden, in: messages).exists, "[NATIVE-UI-OUTSIDE-07] the other group's bet is not listed")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-OUTSIDE-08")

        // The board Oli can open is G2's: Oli under the new name, and not the account that name was taken from.
        try tap("navigation.board", in: messages)
        let own = try required("board.row." + accountID(.oli), in: messages, timeout: 15, "NATIVE-UI-OUTSIDE-09")
        XCTAssertTrue(own.label.contains(Actor.sage.alias), "[NATIVE-UI-OUTSIDE-09] \(own.label)")
        XCTAssertFalse(element("board.row." + (try accountID(.sage)), in: messages).exists, "[NATIVE-UI-OUTSIDE-09] sharing a name does not merge two people")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-OUTSIDE-10")
        XCTAssertEqual(try memberships(.oli, in: "G1").count, 0, "[NATIVE-UI-OUTSIDE-11] Oli was not admitted to G1")
        XCTAssertEqual(try control.rows("invites").count, 0, "[NATIVE-UI-OUTSIDE-11]")
        try assertTheAppCalledOnlyInventoriedFunctions("NATIVE-UI-OUTSIDE-12")
    }

    func testAFriendIsShownTheEligibleFieldsOfTheirOwnGroupOnly() throws {
        let elsewhere = "A question that belongs to G2 " + run.manifest.runID.prefix(8)
        try control.seedBet("bet-a", format: "this_that")
        try control.seedBet("bet-b", group: "G2", creator: "cora", subject: "oli", format: "yes_no", question: elsewhere)
        try pick(.cora, option: 1, confidence: 0.9)
        try start(as: .finn)
        let row = try required("group.bet." + betID("bet-a"), in: messages, "NATIVE-UI-ELIGIBLE-01")
        XCTAssertTrue(row.label.contains(run.secretQuestion), "[NATIVE-UI-ELIGIBLE-01] a friend's list names the question: \(row.label)")
        XCTAssertFalse(element("group.bet." + (try betID("bet-b")), in: messages).exists, "[NATIVE-UI-ELIGIBLE-02] a bet of Finn's other group is not listed in this one")
        XCTAssertEqual(shown(elsewhere, in: messages), 0, "[NATIVE-UI-ELIGIBLE-02]")

        let screen = try openBet("bet-a")
        assertLabel(try required("bet.question", in: screen), run.secretQuestion, "NATIVE-UI-ELIGIBLE-03")
        assertLabel(try required("bet.option.0", in: screen), "PRIVATE_OPTION_A_" + run.manifest.runID, "NATIVE-UI-ELIGIBLE-03")
        assertLabel(try required("bet.option.1", in: screen), "PRIVATE_OPTION_B_" + run.manifest.runID, "NATIVE-UI-ELIGIBLE-03")
        _ = try required("bet.confirmPick", in: screen, "NATIVE-UI-ELIGIBLE-04")
        XCTAssertFalse(element("bet.sealed", in: messages).exists, "[NATIVE-UI-ELIGIBLE-05] the card is not sealed for a friend")
        XCTAssertFalse(element("bet.veto", in: messages).exists, "[NATIVE-UI-ELIGIBLE-05] only the subject can veto")
        XCTAssertFalse(element("bet.answer.0", in: messages).exists, "[NATIVE-UI-ELIGIBLE-05] only the subject answers")
        // Cora's pick is on the server and stays out of a friend's view until the reveal.
        let picks = try control.rows("picks")
        XCTAssertEqual(picks.count, 1, "[NATIVE-UI-ELIGIBLE-06] fixture: one pick on the server")
        XCTAssertEqual(picks.first?["actor"] as? String, "cora", "[NATIVE-UI-ELIGIBLE-06]")
        XCTAssertEqual(shown("GROUP PICKS", in: messages), 0, "[NATIVE-UI-ELIGIBLE-07] nobody's pick is listed before the reveal")
        XCTAssertEqual(shown("Confidence 90 / 100", in: messages), 0, "[NATIVE-UI-ELIGIBLE-07]")
        XCTAssertEqual(shown(Actor.cora.alias, in: screen), 0, "[NATIVE-UI-ELIGIBLE-07] the bet does not name who picked")
        XCTAssertEqual(shown("PRIVATE_CONTEXT_" + run.manifest.runID, in: messages), 0, "[NATIVE-UI-ELIGIBLE-08] the creator's context line is not part of what a friend is given")
        XCTAssertEqual(shown(elsewhere, in: messages), 0, "[NATIVE-UI-ELIGIBLE-08]")
        try assertTheAppCalledOnlyInventoriedFunctions("NATIVE-UI-ELIGIBLE-09")
    }

    func testTheSubjectIsShownOnlyLockedFieldsUntilTheServerReveals() throws {
        try control.seedBet("bet-a", format: "this_that")
        try pick(.finn, option: 0, confidence: 0.8)
        try pick(.cora, option: 1, confidence: 0.6)
        let sides = ["GROUP PICKS", "Confidence 80 / 100", "Confidence 60 / 100"]
        try start(as: .sage)
        let row = try required("group.bet." + betID("bet-a"), in: messages, "NATIVE-UI-LOCKED-01")
        XCTAssertTrue(row.label.contains("A hidden bet about you"), "[NATIVE-UI-LOCKED-01] the list names no question: \(row.label)")
        try assertNoPrivateContent(in: messages, extra: sides, "NATIVE-UI-LOCKED-02")

        // The board is the other screen that reads this group, and it gives the subject nothing of the bet either.
        try tap("navigation.board", in: messages)
        _ = try required("board.row." + accountID(.sage), in: messages, timeout: 15, "NATIVE-UI-LOCKED-03")
        try assertNoPrivateContent(in: messages, extra: sides, "NATIVE-UI-LOCKED-03")
        try goHome()

        let screen = try openBet("bet-a")
        _ = try required("bet.sealed", in: screen, "NATIVE-UI-LOCKED-04")
        assertText("A secret bet about you", in: screen, "NATIVE-UI-LOCKED-04")
        assertText("2 friends are in", in: screen, "NATIVE-UI-LOCKED-05")
        for id in ["bet.question", "bet.option.0", "bet.confirmPick", "bet.answer.0", "bet.revealWithoutRubbing"] {
            XCTAssertFalse(element(id, in: messages).exists, "[NATIVE-UI-LOCKED-06] \(id) is not part of a sealed card")
        }
        try assertNoPrivateContent(in: messages, extra: sides, "NATIVE-UI-LOCKED-07")
        XCTAssertEqual(try bet("bet-a")["state"] as? String, "open", "[NATIVE-UI-LOCKED-08] the bet is still open on the server")

        // Only the server ends the lock. The open screen asks again by itself and changes when the server says so.
        try control.shiftBet("bet-a", to: "revealed")
        let uncover = try required("bet.revealWithoutRubbing", in: messages, timeout: 30, "NATIVE-UI-LOCKED-09")
        assertGone(element("bet.sealed", in: messages), "NATIVE-UI-LOCKED-09")
        try tap(uncover)
        assertText(run.secretQuestion, in: messages, "NATIVE-UI-LOCKED-10")
        _ = try required("bet.answer.0", in: messages, "NATIVE-UI-LOCKED-10")

        // Proof photos and voice notes are cut from V0: where they would be offered, the revealed bet offers none.
        assertText("Unanswered bets void 24 hours after reveal. Your recorded answer starts a one-hour challenge window; the server owns both deadlines.", in: messages, "NATIVE-UI-LOCKED-11")
        XCTAssertEqual(messages.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "proof.")).count, 0, "[NATIVE-UI-LOCKED-12] no proof can be chosen or opened")
        XCTAssertEqual(shown("OPTIONAL PROOF", in: messages), 0, "[NATIVE-UI-LOCKED-12]")
        XCTAssertEqual(shown("Proof is optional", in: messages), 0, "[NATIVE-UI-LOCKED-12]")
        XCTAssertEqual(try control.calls().filter { ($0["path"] as? String ?? "").hasPrefix("v0Proof:") }.count, 0, "[NATIVE-UI-LOCKED-13] the app asked the server for no proof")
        try assertTheAppCalledOnlyInventoriedFunctions("NATIVE-UI-LOCKED-14")
    }

    func testAMemberWhoLeftLosesTheGroupAndRejoiningBringsNothingBack() throws {
        try control.reset(points: ["G1": ["finn": 210]])
        try control.seedBet("bet-a", format: "this_that")
        try start(as: .finn)
        assertText(standing(Actor.finn.alias, points: 210), in: messages, "NATIVE-UI-LEFT-01")
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.question", in: screen), run.secretQuestion, "NATIVE-UI-LEFT-01")

        // Finn leaves G1 from another device while this phone still shows the bet.
        XCTAssertNil(try control.act("finn", "mutation", "v0Controls:leave", ["groupId": "@G1", "requestId": "finn-leaves"]), "[NATIVE-UI-LEFT-02] fixture: leaving was refused")
        assertGone(element("bet.question", in: messages), "NATIVE-UI-LEFT-03", timeout: 30)
        assertText(notAvailable, in: messages, "NATIVE-UI-LEFT-03")
        assertNoPrivateText(in: messages, "NATIVE-UI-LEFT-04")
        XCTAssertGreaterThanOrEqual(try appCalls("v0Bets:get", outcome: "NOT_AVAILABLE"), 1, "[NATIVE-UI-LEFT-04] the server refused the card to a member who left")

        // Coming back takes a new invitation and a new acceptance, like joining the first time.
        XCTAssertNil(try control.act("cora", "mutation", "v0Groups:invite", ["groupId": "@G1", "phone": Actor.finn.phone, "requestId": "cora-invites-finn-back"]), "[NATIVE-UI-LEFT-05] fixture: the invitation was refused")
        try openExtension()
        try openGroups("NATIVE-UI-LEFT-06")
        let first = try groupID("G1"), earlier = try betID("bet-a")
        _ = try required("group.link." + groupID("G2"), in: messages, "NATIVE-UI-LEFT-06")
        XCTAssertFalse(element("group.link." + first, in: messages).exists, "[NATIVE-UI-LEFT-06] the group Finn left is not offered")
        XCTAssertTrue(acceptInvitation.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-LEFT-07] the invitation is offered for explicit acceptance")
        XCTAssertEqual(try memberships(.finn, in: "G1").filter { $0["left"] as? Bool != true }.count, 0, "[NATIVE-UI-LEFT-07] seeing the invitation readmits nobody")

        try tap(acceptInvitation, scrolling: messages)
        try tap("group.link." + first, in: messages)
        _ = try required("navigation.board", in: messages, timeout: 15, "NATIVE-UI-LEFT-08")
        assertText(standing(Actor.finn.alias, points: 0), in: messages, "NATIVE-UI-LEFT-09")
        assertText(noBets, in: messages, "NATIVE-UI-LEFT-10")
        XCTAssertFalse(element("group.bet." + earlier, in: messages).exists, "[NATIVE-UI-LEFT-10] the bet from the earlier membership is not listed")
        assertNoPrivateText(in: messages, "NATIVE-UI-LEFT-11")
        let rows = try memberships(.finn, in: "G1")
        XCTAssertEqual(rows.count, 2, "[NATIVE-UI-LEFT-12] the earlier membership is kept as ended and a new one begins")
        XCTAssertEqual(rows.first { $0["left"] as? Bool == true }?["points"] as? Int, 210, "[NATIVE-UI-LEFT-12] the ended membership keeps its points")
        XCTAssertEqual(rows.first { $0["left"] as? Bool != true }?["points"] as? Int, 0, "[NATIVE-UI-LEFT-12] the new membership starts at 0")

        // A bet made after rejoining, through the real create handler, is listed; the earlier one still is not.
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        let reveal = Date().timeIntervalSince1970 * 1000 + 3 * 3_600_000
        let later = "A bet made after Finn came back " + run.manifest.runID.prefix(8)
        XCTAssertNil(try control.act("cora", "mutation", "v0Bets:create", [
            "groupId": "@G1", "subjectId": "@sage", "question": later, "contextLine": "", "format": "yes_no", "options": ["Yes", "No"],
            "cutoffAt": reveal, "revealAt": reveal, "source": "manual", "requestId": "after-rejoin",
        ]), "[NATIVE-UI-LEFT-13] fixture: the later bet was refused")
        guard let created = try control.rows("bets").first(where: { $0["question"] as? String == later })?["id"] as? String else {
            return XCTFail("[NATIVE-UI-LEFT-13] fixture: the later bet was not created")
        }
        try tap("navigation.board", in: messages)
        try goHome()
        _ = try required("group.bet." + created, in: messages, "NATIVE-UI-LEFT-14")
        XCTAssertFalse(element("group.bet." + earlier, in: messages).exists, "[NATIVE-UI-LEFT-14] the earlier bet stays unavailable")
        assertNoPrivateText(in: messages, "NATIVE-UI-LEFT-15")
        try assertTheAppCalledOnlyInventoriedFunctions("NATIVE-UI-LEFT-16")
    }

    // MARK: SEC1 and SEC2 - a sign-in that was revoked

    func testASignInRevokedElsewhereClosesTheExtensionAndTheHostApp() throws {
        try control.seedBet("bet-a", format: "this_that")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.question", in: screen), run.secretQuestion, "NATIVE-UI-REVOKED-01")

        // Finn signs out of every device from somewhere else: the real public handler, called with another of Finn's sessions.
        let before = try control.calls().count
        XCTAssertNil(try control.act("finn", "mutation", "v0Auth:revoke", ["allDevices": true, "requestId": "revoke-everywhere"]), "[NATIVE-UI-REVOKED-02] fixture: the revocation was refused")
        let sessions = try appSessions(.finn)
        XCTAssertEqual(sessions.count, 1, "[NATIVE-UI-REVOKED-02] fixture: one sign-in on this phone")
        XCTAssertEqual(sessions.first?["revoked"] as? Bool, true, "[NATIVE-UI-REVOKED-02] this phone's sign-in is revoked on the server")

        // Nobody touches the phone. The open bet asks the server again by itself, is refused, and the screen is cleared.
        _ = try required("openPhoneSignIn", in: messages, timeout: 30, "NATIVE-UI-REVOKED-03")
        assertGone(element("bet.question", in: messages), "NATIVE-UI-REVOKED-04")
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-REVOKED-04] no group is shown without a sign-in")
        try assertNoPrivateContent(in: messages, anchor: "Sign in to Called It", "NATIVE-UI-REVOKED-05")
        let calls = Array(try control.calls().dropFirst(before))
        guard let refusal = calls.firstIndex(where: { $0["outcome"] as? String == "AUTH_REQUIRED" }) else {
            return XCTFail("[NATIVE-UI-REVOKED-06] the server refused no call from the app after the revocation")
        }
        XCTAssertEqual(calls[refusal]["caller"] as? String, "CalledItExtension", "[NATIVE-UI-REVOKED-06] the extension itself met the refusal")
        XCTAssertEqual(calls[refusal...].filter { $0["outcome"] as? String == "success" }.count, 0, "[NATIVE-UI-REVOKED-06] nothing was read after the server refused the sign-in")

        // The sign-in is gone from the phone, not only from that screen: the host app, brought back without a relaunch,
        // asks for a phone number again.
        host.activate()
        _ = try required("auth.phone", in: host, timeout: 30, "NATIVE-UI-REVOKED-07")
        XCTAssertFalse(element("auth.returnToMessages", in: host).exists, "[NATIVE-UI-REVOKED-07] the host app does not claim a sign-in")
        XCTAssertFalse(element("auth.signOut", in: host).exists, "[NATIVE-UI-REVOKED-07]")
        XCTAssertEqual(try appCalls("v0Auth:verifyCode"), 1, "[NATIVE-UI-REVOKED-08] nothing signed in again by itself")
        try assertTheAppCalledOnlyInventoriedFunctions("NATIVE-UI-REVOKED-09")
    }
}
