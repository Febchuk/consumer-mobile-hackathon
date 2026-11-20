import XCTest

/// Journeys 8 and 9: what stops, what is removed and what stays shut when a person opts out of bets, leaves a group,
/// deletes their account or holds an old invitation. Every case is driven through the real screens; the other people act
/// through the real public handlers, and the server's rows are read back after each step.
final class CascadeJourneyTests: JourneyCase {
    private let notAvailable = "This isn't available to your account. An earlier card may be outside your membership."
    private let invalid = "Check your entries and try again."
    private let failed = "Couldn't complete this request. Check your connection and try again."
    private let noEarlierBets = "No available bets since you joined. Earlier cards stay unavailable, including after rejoining."
    private let known: Set<String> = ["cora", "finn", "sage", "oli"]

    private var accept: XCUIElement {
        messages.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "group.accept.")).firstMatch
    }

    private var ideas: XCUIElementQuery {
        messages.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "compose.suggestion."))
    }

    /// Waits for something on screen that no single element stands for.
    private func shows(_ code: String, _ what: String, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line, _ condition: @escaping () -> Bool) {
        let reached = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [reached], timeout: timeout * Self.pace), .completed, "[\(code)] \(what)", file: file, line: line)
    }

    private func memberships(_ actor: Actor, in group: String) throws -> [[String: Any]] {
        try control.rows("memberships").filter { $0["actor"] as? String == actor.rawValue && $0["group"] as? String == group }
    }

    /// How each of the app's calls to one public function ended, in order.
    private func outcomes(_ path: String) throws -> [String] {
        try control.calls().filter { $0["path"] as? String == path }.compactMap { $0["outcome"] as? String }
    }

    private func pick(_ actor: Actor, _ key: String, option: Int, confidence: Double) throws {
        XCTAssertNil(try control.act(actor.rawValue, "mutation", "v0Bets:pick", ["betId": "@bet:" + key, "option": option, "confidence": confidence, "requestId": actor.rawValue + "-picks-" + key]), "[NATIVE-UI-FIXTURE] \(actor.rawValue) could not pick on \(key)")
    }

    private func invite(_ actor: Actor, by inviter: Actor, request: String) throws {
        XCTAssertNil(try control.act(inviter.rawValue, "mutation", "v0Groups:invite", ["groupId": "@G1", "phone": actor.phone, "requestId": request]), "[NATIVE-UI-FIXTURE] the invitation was refused")
    }

    private func setPrivacy(_ actor: Actor, noBets: Bool, topics: [String], request: String) throws {
        XCTAssertNil(try control.act(actor.rawValue, "mutation", "v0Controls:update", ["noBets": noBets, "blockedTopics": topics, "hostedAiConsent": false, "requestId": request]), "[NATIVE-UI-FIXTURE] the privacy setting was refused")
    }

    // MARK: J8.1

    func testNoBetsAboutMeClosesEveryWayTheAppCreatesABetUntilItIsTurnedOff() throws {
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        try start(as: .cora)
        try tap("turn.create", in: messages)
        let question = try required("compose.question", in: messages, "NATIVE-UI-PATHS-01")
        XCTAssertTrue(ideas.firstMatch.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-PATHS-01] suggestions about Sage are offered while Sage allows bets")

        // Sage turns on "No bets about me" while Cora's new-bet screen about Sage is already open.
        try setPrivacy(.sage, noBets: true, topics: [], request: "sage-no-bets")

        // The person's own text.
        try type("Will the fixture win at cards", into: "compose.question")
        try tap("compose.create", in: messages)
        eventually("NATIVE-UI-PATHS-02") { try self.appCalls("v0Bets:create", outcome: "NOT_AVAILABLE") == 1 }
        assertText(notAvailable, in: messages, "NATIVE-UI-PATHS-02")
        XCTAssertEqual(try control.rows("bets").count, 0, "[NATIVE-UI-PATHS-02] typed text about Sage creates nothing")

        // A suggestion that was offered before Sage opted out.
        try tap(ideas.firstMatch, scrolling: messages)
        shows("NATIVE-UI-PATHS-03", "the chosen suggestion replaces the typed question") {
            let now = question.value as? String ?? ""
            return !now.isEmpty && now != question.placeholderValue && now != "Will the fixture win at cards"
        }
        try tap("compose.create", in: messages)
        eventually("NATIVE-UI-PATHS-03") { try self.appCalls("v0Bets:create", outcome: "NOT_AVAILABLE") == 2 }
        XCTAssertEqual(try control.rows("bets").count, 0, "[NATIVE-UI-PATHS-03] a suggestion offered earlier creates nothing")

        // Asking for suggestions again.
        try tap("compose.suggestions", in: messages)
        eventually("NATIVE-UI-PATHS-04") { try self.appCalls("v0Suggestions:get", outcome: "NOT_AVAILABLE") == 1 }
        shows("NATIVE-UI-PATHS-04", "no suggestion about Sage is left on screen") { self.ideas.count == 0 }

        // Starting again from the group's home: the turn about Sage is gone and Sage cannot be chosen.
        try goHome()
        assertText("No creator turn available", in: messages, "NATIVE-UI-PATHS-05")
        XCTAssertFalse(element("turn.create", in: messages).exists, "[NATIVE-UI-PATHS-05] no turn about Sage is offered")
        try tap("navigation.newBet", in: messages)
        try tap("compose.subject", in: messages)
        let finn = try labelled("QA Finn", in: messages)
        XCTAssertFalse(labelled("QA Sage", in: messages, timeout: 2, quiet: true), "[NATIVE-UI-PATHS-06] Sage is not offered as the person a bet is about")
        try tap(finn)
        XCTAssertEqual(try appCalls("v0Bets:create"), 0, "[NATIVE-UI-PATHS-07] no create request succeeded")
        XCTAssertEqual(try control.rows("bets").count, 0, "[NATIVE-UI-PATHS-07] no bet about Sage exists")

        // Sage turns the setting off again and blocks one topic: the turn comes back, its suggestions leave the topic out,
        // and one of them creates the bet.
        try setPrivacy(.sage, noBets: false, topics: ["song"], request: "sage-allows-bets")
        try goHome()
        try tap("turn.create", in: messages)
        shows("NATIVE-UI-PATHS-08", "three to five suggestions, none on the blocked topic") {
            (3...5).contains(self.ideas.count) && self.ideas.matching(NSPredicate(format: "label CONTAINS[c] %@", "song")).count == 0
        }
        let again = try required("compose.question", in: messages, "NATIVE-UI-PATHS-09")
        try tap(ideas.firstMatch, scrolling: messages)
        shows("NATIVE-UI-PATHS-09", "the chosen suggestion fills the question") {
            let now = again.value as? String ?? ""
            return !now.isEmpty && now != again.placeholderValue
        }
        try tap("compose.create", in: messages)
        eventually("NATIVE-UI-PATHS-10") { try self.control.rows("bets").count == 1 }
        let created = try control.rows("bets").first
        XCTAssertEqual(created?["subject"] as? String, "sage", "[NATIVE-UI-PATHS-10] with the setting off, the same path creates the bet")
        XCTAssertEqual(created?["source"] as? String, "template", "[NATIVE-UI-PATHS-10] the bet came from a suggestion")
        XCTAssertFalse((created?["question"] as? String ?? "song").localizedCaseInsensitiveContains("song"), "[NATIVE-UI-PATHS-10] the bet is not on the blocked topic")
    }

    // MARK: J8.2, J9.2

    func testTheSubjectLeavingCancelsTheBetAboutThemAndRejoiningStartsClean() throws {
        // A bet Sage scored on, an open bet about Sage that Finn picked on, an open bet Sage picked on, today's turn about
        // Sage and an invitation Sage sent.
        try control.seedBet("settled", creator: "cora", subject: "finn", question: "A bet settled before Sage left")
        try pick(.sage, "settled", option: 0, confidence: 0.8)
        try control.shiftBet("settled", to: "revealed")
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:answer", ["betId": "@bet:settled", "option": 0, "requestId": "finn-answers"]))
        try control.shiftBet("settled", to: "challengeOver")
        try control.seedBet("about-sage", creator: "cora", subject: "sage")
        try pick(.finn, "about-sage", option: 0, confidence: 0.7)
        try control.seedBet("other", creator: "cora", subject: "finn", question: "An open bet Sage picked on")
        try pick(.sage, "other", option: 1, confidence: 0.6)
        try control.seedTurn(group: "G1", creator: "finn", subject: "sage")
        try invite(.oli, by: .sage, request: "sage-invites-oli")
        XCTAssertEqual(try memberships(.sage, in: "G1").first?["points"] as? Double, 80, "[NATIVE-UI-FIXTURE] Sage scored 80 on the settled bet")

        try start(as: .sage)
        assertText("You're QA Sage · 80 group points · streak 1", in: messages, "NATIVE-UI-SUBJECT-01")
        for key in ["settled", "about-sage", "other"] { _ = try required("group.bet." + betID(key), in: messages, "NATIVE-UI-SUBJECT-01") }
        try tap("navigation.settings", in: messages)
        try tap("settings.leave", in: messages)
        try tap(labelled("Leave group", in: messages))
        assertText("Your groups", in: messages, "NATIVE-UI-SUBJECT-02", timeout: 15)
        XCTAssertFalse(element("group.link." + (try groupID("G1")), in: messages).exists, "[NATIVE-UI-SUBJECT-02] the group left is no longer offered")

        // The bet about Sage is cancelled with its picks; Sage's own open pick is voided; what was settled stays.
        XCTAssertEqual(try appCalls("v0Controls:leave"), 1, "[NATIVE-UI-SUBJECT-03]")
        XCTAssertEqual(try bet("about-sage")["state"] as? String, "voided", "[NATIVE-UI-SUBJECT-03] the open bet about Sage is cancelled")
        XCTAssertEqual(try bet("other")["state"] as? String, "open", "[NATIVE-UI-SUBJECT-04] a bet about someone else goes on")
        XCTAssertEqual(try bet("settled")["state"] as? String, "finalized", "[NATIVE-UI-SUBJECT-04] a settled bet stays settled")
        let picks = try control.rows("picks")
        func voided(_ key: String, _ actor: String) -> Bool? {
            picks.first { $0["bet"] as? String == key && $0["actor"] as? String == actor }?["voided"] as? Bool
        }
        XCTAssertEqual(voided("about-sage", "finn"), true, "[NATIVE-UI-SUBJECT-05] the pick on the cancelled bet is voided")
        XCTAssertEqual(voided("other", "sage"), true, "[NATIVE-UI-SUBJECT-05] Sage's open pick is voided")
        XCTAssertEqual(voided("settled", "sage"), false, "[NATIVE-UI-SUBJECT-05] Sage's settled pick stays")
        let left = try memberships(.sage, in: "G1")
        XCTAssertEqual(left.count, 1, "[NATIVE-UI-SUBJECT-06]")
        XCTAssertEqual(left.first?["left"] as? Bool, true, "[NATIVE-UI-SUBJECT-06] the membership is closed")
        XCTAssertEqual(try control.rows("turns").first { $0["group"] as? String == "G1" }?["status"] as? String, "expired", "[NATIVE-UI-SUBJECT-07] today's turn about Sage ends")
        XCTAssertEqual(try control.rows("invites").first { $0["inviter"] as? String == "sage" }?["revoked"] as? Bool, true, "[NATIVE-UI-SUBJECT-07] the invitation Sage sent is withdrawn")
        XCTAssertFalse(try appLinks().contains { $0["actor"] as? String == "sage" }, "[NATIVE-UI-SUBJECT-07] the conversation link is removed")

        // Cora invites Sage back and Sage accepts on the same screen.
        try invite(.sage, by: .cora, request: "cora-invites-sage-back")
        try tap(labelled("Home", in: messages))
        XCTAssertTrue(accept.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-REJOIN-01] the new invitation is offered")
        try tap(accept, scrolling: messages)
        try tap("group.link." + groupID("G1"), in: messages)
        _ = try required("navigation.board", in: messages, "NATIVE-UI-REJOIN-02")

        // A new membership from zero, with nothing from before on screen and nothing revived on the server.
        assertText("You're QA Sage · 0 group points · streak 0", in: messages, "NATIVE-UI-REJOIN-03")
        assertText(noEarlierBets, in: messages, "NATIVE-UI-REJOIN-04")
        for key in ["settled", "about-sage", "other"] {
            XCTAssertFalse(element("group.bet." + (try betID(key)), in: messages).exists, "[NATIVE-UI-REJOIN-04] \(key), from before Sage left, is not listed")
        }
        assertText("No creator turn available", in: messages, "NATIVE-UI-REJOIN-05")
        assertNoPrivateText(in: messages, "NATIVE-UI-REJOIN-06")
        let rows = try memberships(.sage, in: "G1")
        XCTAssertEqual(rows.count, 2, "[NATIVE-UI-REJOIN-07] rejoining opens a second membership")
        XCTAssertEqual(rows.first { $0["left"] as? Bool == true }?["points"] as? Double, 80, "[NATIVE-UI-REJOIN-07] the closed membership keeps its points")
        let active = rows.first { $0["left"] as? Bool == false }
        XCTAssertEqual(active?["points"] as? Double, 0, "[NATIVE-UI-REJOIN-07] the new membership starts at zero")
        XCTAssertEqual(active?["streak"] as? Double, 0, "[NATIVE-UI-REJOIN-07]")
        XCTAssertEqual(try bet("about-sage")["state"] as? String, "voided", "[NATIVE-UI-REJOIN-08] the cancelled bet stays cancelled")
        XCTAssertEqual(try control.rows("picks").filter { $0["voided"] as? Bool == true }.count, 2, "[NATIVE-UI-REJOIN-08] no voided pick comes back")
        XCTAssertEqual(try control.rows("turns").first { $0["group"] as? String == "G1" }?["status"] as? String, "expired", "[NATIVE-UI-REJOIN-08] the ended turn stays ended")
    }

    func testAFormerMemberCannotSettleABetFromBeforeTheyLeft() throws {
        try control.seedBet("bet-a", format: "yes_no")
        try pick(.finn, "bet-a", option: 0, confidence: 0.8)
        try pick(.cora, "bet-a", option: 1, confidence: 0.6)
        try control.shiftBet("bet-a", to: "revealed")
        XCTAssertNil(try control.act("sage", "mutation", "v0Bets:answer", ["betId": "@bet:bet-a", "option": 1, "requestId": "sage-answers"]))
        try start(as: .finn)
        let screen = try openBet("bet-a")
        _ = try required("bet.challenge", in: screen, "NATIVE-UI-FORMER-01")

        // Finn leaves the group from another sign-in while this screen, with its challenge button, is still open.
        XCTAssertNil(try control.act("finn", "mutation", "v0Controls:leave", ["groupId": "@G1", "requestId": "finn-leaves"]))
        assertGone(element("bet.challenge", in: screen), "NATIVE-UI-FORMER-02", timeout: 30)
        assertGone(element("bet.question", in: screen), "NATIVE-UI-FORMER-02")
        assertText(notAvailable, in: messages, "NATIVE-UI-FORMER-03")
        // The sign-in from before Finn left gets no challenge either.
        XCTAssertEqual(try control.act("finn", "mutation", "v0Bets:challenge", ["betId": "@bet:bet-a", "requestId": "finn-challenges-after-leaving"]), "NOT_AVAILABLE", "[NATIVE-UI-FORMER-04]")
        XCTAssertEqual(try control.rows("challenges").count, 0, "[NATIVE-UI-FORMER-04] no challenge was recorded")

        // Cora invites Finn back; Finn accepts and links the conversation again.
        try invite(.finn, by: .cora, request: "cora-invites-finn-back")
        try tap(labelled("Home", in: messages))
        try tap("navigation.groups", in: messages)
        XCTAssertTrue(accept.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-FORMER-05] the new invitation is offered")
        try tap(accept, scrolling: messages)
        try tap("group.link." + groupID("G1"), in: messages)
        _ = try required("navigation.board", in: messages, "NATIVE-UI-FORMER-05")
        assertText("You're QA Finn · 0 group points · streak 0", in: messages, "NATIVE-UI-FORMER-06")
        assertText(noEarlierBets, in: messages, "NATIVE-UI-FORMER-06")
        XCTAssertFalse(element("group.bet." + (try betID("bet-a")), in: messages).exists, "[NATIVE-UI-FORMER-06] the bet from before Finn left is not offered again")
        XCTAssertEqual(try control.act("finn", "mutation", "v0Bets:challenge", ["betId": "@bet:bet-a", "requestId": "finn-challenges-after-rejoining"]), "NOT_AVAILABLE", "[NATIVE-UI-FORMER-07] rejoining gives no say on the earlier bet")
        XCTAssertEqual(try control.rows("challenges").count, 0, "[NATIVE-UI-FORMER-07]")

        // The bet settles without Finn: no points for the voided pick, and still nothing on Finn's screen.
        try control.shiftBet("bet-a", to: "challengeOver")
        XCTAssertEqual(try bet("bet-a")["state"] as? String, "finalized", "[NATIVE-UI-FORMER-08] the others' bet is settled by the subject's answer")
        XCTAssertEqual(try control.rows("ledger").compactMap { $0["actor"] as? String }, ["cora"], "[NATIVE-UI-FORMER-08] only the member who stayed is scored")
        try tap("navigation.board", in: messages)
        try goHome()
        assertText("You're QA Finn · 0 group points · streak 0", in: messages, "NATIVE-UI-FORMER-09")
        assertText(noEarlierBets, in: messages, "NATIVE-UI-FORMER-09")
        XCTAssertFalse(element("group.bet." + (try betID("bet-a")), in: messages).exists, "[NATIVE-UI-FORMER-09] the settled bet is not listed either")
    }

    // MARK: J8.3

    func testDeletingTheAccountRemovesItsBetsAndPicksAndARepeatedRequestChangesNothing() throws {
        // A bet Oli made (with its context line), a bet about Oli, and a bet between the others that Oli picked on.
        try control.seedBet("by-oli", group: "G2", creator: "oli", subject: "finn", format: "this_that")
        try control.seedBet("about-oli", group: "G2", creator: "cora", subject: "oli")
        try control.seedBet("kept", group: "G2", creator: "cora", subject: "finn", question: "A bet between the others")
        try pick(.cora, "by-oli", option: 0, confidence: 0.5)
        try pick(.finn, "about-oli", option: 1, confidence: 0.9)
        try pick(.oli, "kept", option: 0, confidence: 0.7)
        try pick(.cora, "kept", option: 1, confidence: 0.6)
        try start(as: .oli, in: "G2")
        for key in ["by-oli", "about-oli", "kept"] { _ = try required("group.bet." + betID(key), in: messages, "NATIVE-UI-ERASE-01") }

        // The server deletes the account and the reply is lost, so the app repeats the request by itself.
        try control.call("loseNextReply", ["path": "v0Controls:deleteAccount", "count": 1])
        try tap("navigation.settings", in: messages)
        try tap("settings.delete", in: messages)
        try tap(labelled("Delete account and data", in: messages))
        _ = try labelled("Sign in with phone number", in: messages, timeout: 30)
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-ERASE-02] no group is shown after deletion")
        // After the confirmation dialog a whole-app snapshot leaves the extension out, so the sign-in screen proven above is
        // searched directly.
        assertNoPrivateText(in: messages, "NATIVE-UI-ERASE-02")
        XCTAssertEqual(try outcomes("v0Controls:deleteAccount"), ["injected", "AUTH_REQUIRED"], "[NATIVE-UI-ERASE-03] the first request deleted the account, and its repeat was answered as signed out")

        // What the deleted person made or took part in is gone; the others' bet and pick are untouched.
        let tables = ["accountRows", "bets", "picks", "memberships", "sessions", "links", "challenges", "ledger", "outbox", "invites", "turns"]
        func state() throws -> [NSArray] { try tables.map { try control.rows($0) as NSArray } }
        let after = try state()
        let accounts = try control.rows("accountRows")
        XCTAssertEqual(accounts.filter { $0["deleted"] as? Bool == true }.count, 1, "[NATIVE-UI-ERASE-04] exactly one account is deleted")
        XCTAssertFalse(accounts.contains { $0["actor"] as? String == "oli" }, "[NATIVE-UI-ERASE-04] the phone number no longer leads to an account")
        let bets = try control.rows("bets")
        XCTAssertEqual(bets.map { $0["key"] as? String }, ["kept"], "[NATIVE-UI-ERASE-05] the bet Oli made, with its question and context, and the bet about Oli are deleted")
        XCTAssertEqual(bets.first?["state"] as? String, "open", "[NATIVE-UI-ERASE-05] the others' bet goes on")
        let picks = try control.rows("picks")
        XCTAssertEqual(picks.count, 1, "[NATIVE-UI-ERASE-06] Oli's pick and the picks on the deleted bets are deleted")
        XCTAssertEqual(picks.first?["actor"] as? String, "cora", "[NATIVE-UI-ERASE-06]")
        XCTAssertEqual(picks.first?["bet"] as? String, "kept", "[NATIVE-UI-ERASE-06]")
        for table in ["memberships", "sessions", "links", "picks", "challenges", "outbox"] {
            let foreign = try control.rows(table).filter { !known.contains($0["actor"] as? String ?? "") }
            XCTAssertEqual(foreign.count, 0, "[NATIVE-UI-ERASE-07] no row of the deleted account is left in \(table)")
        }
        XCTAssertEqual(try control.rows("memberships").filter { $0["group"] as? String == "G2" }.compactMap { $0["actor"] as? String }.sorted(), ["cora", "finn"], "[NATIVE-UI-ERASE-07] the others are still in the group")

        // A third request, from the deleted account's other sign-in, is refused and changes nothing.
        XCTAssertEqual(try control.act("oli", "mutation", "v0Controls:deleteAccount", ["requestId": "oli-deletes-again"]), "AUTH_REQUIRED", "[NATIVE-UI-ERASE-08]")
        XCTAssertEqual(try state(), after, "[NATIVE-UI-ERASE-08] a repeated delete changes no row")

        // The same phone number signs in again: a new, empty account. Nothing deleted comes back.
        try signIn(.oli)
        try openExtension()
        try tap(labelled("Link this conversation", in: messages))
        assertText("Your groups", in: messages, "NATIVE-UI-ERASE-09")
        assertText("No pending invitations.", in: messages, "NATIVE-UI-ERASE-09")
        XCTAssertEqual(messages.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "group.link.")).count, 0, "[NATIVE-UI-ERASE-09] the new account is in no group")
        assertNoPrivateText(in: messages, "NATIVE-UI-ERASE-09")
        let later = try control.rows("accountRows")
        XCTAssertEqual(later.filter { $0["deleted"] as? Bool == true }.count, 1, "[NATIVE-UI-ERASE-10] the deleted account stays deleted")
        XCTAssertEqual(later.first { $0["actor"] as? String == "oli" }?["deleted"] as? Bool, false, "[NATIVE-UI-ERASE-10] the phone number now leads to a new account")
        XCTAssertEqual(try control.rows("memberships").filter { $0["actor"] as? String == "oli" }.count, 0, "[NATIVE-UI-ERASE-10] with no membership")
        XCTAssertEqual(try control.rows("bets").map { $0["key"] as? String }, ["kept"], "[NATIVE-UI-ERASE-10] and no bet came back")
    }

    // MARK: J8.4

    func testSettingsShowASavedStateOrAnErrorNeverBoth() throws {
        try start(as: .sage)
        try tap("navigation.settings", in: messages)
        let toggle = try required("settings.noBets", in: messages, timeout: 15, "NATIVE-UI-STATE-01")
        XCTAssertEqual(toggle.value as? String, "0", "[NATIVE-UI-STATE-01] off to begin with")
        func noBets() throws -> Bool? { try control.rows("accountRows").first { $0["actor"] as? String == "sage" }?["noBets"] as? Bool }

        // A save that fails on the server, three times: the error is said, the switch goes back, nothing claims to be saved.
        try control.failNext("v0Controls:update", count: 3)
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        assertText(failed, in: messages, "NATIVE-UI-STATE-02")
        shows("NATIVE-UI-STATE-02", "the switch shows the setting the server still holds") { toggle.value as? String == "0" }
        XCTAssertFalse(element("settings.result", in: messages).exists, "[NATIVE-UI-STATE-02] a failed save is not shown as saved")
        XCTAssertEqual(try outcomes("v0Controls:update"), ["injected", "injected", "injected"], "[NATIVE-UI-STATE-02] three attempts, then the app stops by itself")
        XCTAssertEqual(try noBets(), false, "[NATIVE-UI-STATE-02] nothing was saved")

        // The same switch again, with the server answering: saved, and the earlier error is gone.
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        assertLabel(try required("settings.result", in: messages, timeout: 15, "NATIVE-UI-STATE-03"), "Privacy settings saved.", "NATIVE-UI-STATE-03")
        shows("NATIVE-UI-STATE-03", "the switch shows the saved setting") { toggle.value as? String == "1" }
        assertGone(text(failed, in: messages), "NATIVE-UI-STATE-03")
        XCTAssertEqual(try noBets(), true, "[NATIVE-UI-STATE-03] saved on the server")

        // An entry the server refuses: the refusal is said and the earlier "saved" line is gone.
        try type("trains/planes", into: "settings.topics")
        try tap(labelled("Save blocked topics", in: messages), scrolling: messages)
        assertText(invalid, in: messages, "NATIVE-UI-STATE-04")
        assertGone(element("settings.result", in: messages), "NATIVE-UI-STATE-04")
        XCTAssertEqual(try appCalls("v0Controls:update", outcome: "INVALID_INPUT"), 1, "[NATIVE-UI-STATE-04] the server refused it")
        let account = try control.rows("accountRows").first { $0["actor"] as? String == "sage" }
        XCTAssertEqual(account?["blockedTopics"] as? [String], [], "[NATIVE-UI-STATE-04] no topic was saved")
        XCTAssertEqual(account?["noBets"] as? Bool, true, "[NATIVE-UI-STATE-04] the setting saved before is kept")

        // Another request that succeeds: its confirmation is shown and the refusal is gone.
        try type("Synthetic safety report", into: "settings.reportReason")
        try tap("settings.report", in: messages)
        assertLabel(try required("settings.result", in: messages, timeout: 15, "NATIVE-UI-STATE-05"), "Request saved.", "NATIVE-UI-STATE-05")
        assertGone(text(invalid, in: messages), "NATIVE-UI-STATE-05")
        XCTAssertEqual(try control.rows("reports").count, 1, "[NATIVE-UI-STATE-05] the report is stored")
    }

    // MARK: J9.1

    func testAnInvitationAdmitsOnceAndNotAfterItsSevenDays() throws {
        try invite(.oli, by: .cora, request: "cora-invites-oli")
        XCTAssertEqual(try control.rows("invites").first?["lifetimeMs"] as? Double, 7 * 24 * 3_600_000, "[NATIVE-UI-ONCE-01] an invitation lasts seven days")
        try signIn(.oli)
        try openExtension()
        try tap(labelled("Link this conversation", in: messages))
        XCTAssertTrue(accept.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-ONCE-01] the invitation is offered")
        let expiredID = String(accept.identifier.dropFirst("group.accept.".count))

        // The seven days pass while the invitation is still on screen.
        try control.call("expireInvites", ["group": "G1"])
        XCTAssertEqual(try control.rows("invites").first?["expired"] as? Bool, true, "[NATIVE-UI-FIXTURE] the invitation is past its seven days")
        try tap(accept, scrolling: messages)
        eventually("NATIVE-UI-ONCE-02") { try self.appCalls("v0Groups:accept", outcome: "NOT_AVAILABLE") == 1 }
        assertText(notAvailable, in: messages, "NATIVE-UI-ONCE-02")
        XCTAssertEqual(try memberships(.oli, in: "G1").count, 0, "[NATIVE-UI-ONCE-02] an expired invitation admits nobody")
        XCTAssertEqual(try control.rows("invites").first?["accepted"] as? Bool, false, "[NATIVE-UI-ONCE-02]")
        try tap(labelled("Home", in: messages))
        assertText("No pending invitations.", in: messages, "NATIVE-UI-ONCE-03")
        XCTAssertFalse(accept.exists, "[NATIVE-UI-ONCE-03] an expired invitation is no longer offered")

        // A second invitation is a new one, and it is used up by accepting it.
        try invite(.oli, by: .cora, request: "cora-invites-oli-again")
        XCTAssertEqual(try control.rows("invites").count, 2, "[NATIVE-UI-FIXTURE] the second invitation is a new row")
        try tap("navigation.settings", in: messages)
        _ = try required("settings.noBets", in: messages, timeout: 15, "NATIVE-UI-ONCE-04")
        try tap(labelled("Home", in: messages))
        XCTAssertTrue(accept.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-ONCE-04] the new invitation is offered")
        let usedID = String(accept.identifier.dropFirst("group.accept.".count))
        XCTAssertNotEqual(usedID, expiredID, "[NATIVE-UI-ONCE-04] it is not the expired invitation")
        try tap(accept, scrolling: messages)
        _ = try required("group.link." + groupID("G1"), in: messages, "NATIVE-UI-ONCE-05")
        assertText("No pending invitations.", in: messages, "NATIVE-UI-ONCE-05")
        XCTAssertFalse(accept.exists, "[NATIVE-UI-ONCE-05] an accepted invitation is not offered again")
        XCTAssertEqual(try appCalls("v0Groups:accept"), 1, "[NATIVE-UI-ONCE-05]")
        XCTAssertEqual(try control.rows("invites").filter { $0["accepted"] as? Bool == true }.count, 1, "[NATIVE-UI-ONCE-05]")
        XCTAssertEqual(try memberships(.oli, in: "G1").map { $0["left"] as? Bool }, [false], "[NATIVE-UI-ONCE-05] one acceptance, one membership")

        // Neither invitation can be used again, also not to come back after leaving.
        for (id, request) in [(usedID, "oli-reuses-accepted"), (expiredID, "oli-reuses-expired")] {
            XCTAssertEqual(try control.act("oli", "mutation", "v0Groups:accept", ["inviteId": id, "requestId": request]), "NOT_AVAILABLE", "[NATIVE-UI-ONCE-06] \(request)")
        }
        XCTAssertEqual(try memberships(.oli, in: "G1").count, 1, "[NATIVE-UI-ONCE-06] a used invitation adds no second membership")
        XCTAssertNil(try control.act("oli", "mutation", "v0Controls:leave", ["groupId": "@G1", "requestId": "oli-leaves"]))
        XCTAssertEqual(try control.act("oli", "mutation", "v0Groups:accept", ["inviteId": usedID, "requestId": "oli-reuses-after-leaving"]), "NOT_AVAILABLE", "[NATIVE-UI-ONCE-07]")
        XCTAssertEqual(try memberships(.oli, in: "G1").map { $0["left"] as? Bool }, [true], "[NATIVE-UI-ONCE-07] the used invitation does not bring Oli back")
    }
}
