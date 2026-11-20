import XCTest

/// Journey 5, the rules around the reveal: a screen that was away when the reveal happened, how a minority, a tie and a
/// majority of challenges are decided, what the screen shows when a deadline passes while it is open, and what preparing
/// a result card does and does not claim. The deadlines are moved with the fixture clock (a bet's own timestamps); the
/// product's sweep performs every transition.
final class RevealRulesJourneyTests: JourneyCase {
    private let answerFootnote = "Unanswered bets void 24 hours after reveal. Your recorded answer starts a one-hour challenge window; the server owns both deadlines."
    private let resultFootnote = "This prepares a neutral update to this bet's Messages session. You tap Send. It doesn't silently edit a previously sent card or post in the background."

    // MARK: Fixtures

    private func pick(_ actor: String, on key: String, option: Int, confidence: Double) throws {
        XCTAssertNil(try control.act(actor, "mutation", "v0Bets:pick", ["betId": "@bet:" + key, "option": option, "confidence": confidence, "requestId": actor + "-pick-" + key]), "[NATIVE-UI-RULES-FIXTURE] \(actor) picks on \(key)")
    }

    private func answer(_ key: String, option: Int) throws {
        XCTAssertNil(try control.act("sage", "mutation", "v0Bets:answer", ["betId": "@bet:" + key, "option": option, "requestId": "sage-answer-" + key]), "[NATIVE-UI-RULES-FIXTURE] Sage answers \(key)")
    }

    /// A bet about Sage that Finn (Yes, 80) and Cora (No, 60) picked on, revealed by the product's sweep.
    private func seedRevealedBet(_ key: String = "bet-a", question: String? = nil, alsoPicking extra: [String] = []) throws {
        try control.seedBet(key, format: "yes_no", question: question)
        try pick("finn", on: key, option: 0, confidence: 0.8)
        try pick("cora", on: key, option: 1, confidence: 0.6)
        for actor in extra { try pick(actor, on: key, option: 0, confidence: 0.5) }
        try control.shiftBet(key, to: "revealed")
    }

    private func state(of key: String) throws -> String? { try bet(key)["state"] as? String }

    private func ledger(for key: String) throws -> [[String: Any]] {
        try control.rows("ledger").filter { $0["bet"] as? String == key }
    }

    private func outbox(_ kind: String) throws -> Int {
        try control.rows("outbox").filter { $0["kind"] as? String == kind }.count
    }

    /// Calls the extension made that the server answered, by path prefix.
    private func extensionCalls(_ prefix: String) throws -> Int {
        try control.calls().filter { ($0["path"] as? String ?? "").hasPrefix(prefix) && $0["caller"] as? String == "CalledItExtension" && $0["outcome"] as? String == "success" }.count
    }

    // MARK: Screen

    private func assertLabelContains(_ target: XCUIElement, _ value: String, _ code: String, file: StaticString = #filePath, line: UInt = #line) {
        let reached = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", value), object: target)], timeout: 20 * Self.pace) == .completed
        XCTAssertTrue(reached, "[\(code)] expected a label containing \"\(value)\", found \"\(target.exists ? target.label : "nothing")\"", file: file, line: line)
    }

    /// Proof photos and voice notes are cut from V0: no proof control, no proof wording, and no call to the proof functions.
    private func assertNoProofSurface(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let controls = messages.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "proof."))
        XCTAssertEqual(controls.count, 0, "[\(code)] no proof control is offered", file: file, line: line)
        let wording = messages.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", "proof"))
        XCTAssertEqual(wording.count, 0, "[\(code)] nothing on screen mentions proof", file: file, line: line)
        XCTAssertEqual(try control.calls().filter { ($0["path"] as? String ?? "").hasPrefix("v0Proof:") }.count, 0, "[\(code)] the app never calls the proof functions", file: file, line: line)
    }

    /// Everything the bet screen says and offers, to compare what it claims at two moments.
    private func statements(on screen: XCUIElement) throws -> [String] {
        var found: [String] = []
        func walk(_ node: XCUIElementSnapshot) {
            if [.staticText, .button].contains(node.elementType), !node.label.isEmpty { found.append(node.label) }
            node.children.forEach(walk)
        }
        walk(try screen.snapshot())
        return found.sorted()
    }

    /// Puts the extension back on screen in the conversation Messages is already showing, without relaunching Messages.
    /// Messages can close an extension when it leaves the foreground or takes a draft; a person opens it again from the
    /// app drawer, as the shared helper does.
    private func showExtensionAgain(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        // A system onboarding sheet can cover Messages when it returns; a person would dismiss it.
        let sheet = messages.buttons.matching(NSPredicate(format: "label IN %@", ["OK", "Continue"])).firstMatch
        while sheet.waitForExistence(timeout: 4 * Self.pace) { sheet.tap() }
        assertLabel(try required("ConversationTitle", in: messages, timeout: 30, code, file: file, line: line), Self.conversations[0], code, file: file, line: line)
        if !element("navigation.settings", in: messages).waitForExistence(timeout: 4 * Self.pace) {
            try tap(labelled("add", in: messages, file: file, line: line), file: file, line: line)
            try tap(labelled("Called It", .cell, in: messages, file: file, line: line), file: file, line: line)
        }
        _ = try required("navigation.settings", in: messages, timeout: 30, code, file: file, line: line)
    }

    /// From whatever the extension is showing, compact or expanded, to the linked group's home: Settings is offered
    /// everywhere and always opens expanded, and Home leads back from it.
    private func openGroupHome(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        try tap("navigation.settings", in: messages, file: file, line: line)
        _ = try required("settings.noBets", in: messages, timeout: 15, code, file: file, line: line)
        try goHome(file: file, line: line)
    }

    // MARK: J5.1 resume refresh

    func testAScreenThatWasAwayAtTheRevealShowsItOnReturn() throws {
        try control.seedBet("bet-a", format: "yes_no")
        try pick("cora", on: "bet-a", option: 1, confidence: 0.6)
        try start(as: .finn)
        let before = try openBet("bet-a")
        _ = try required("bet.confirmPick", in: before, "NATIVE-UI-RESUME-01")
        XCTAssertFalse(text("QA Cora", in: before).exists, "[NATIVE-UI-RESUME-01] nobody's pick is shown before the reveal")

        // The person leaves Messages with the bet open. The reveal happens on the server while the screen is away.
        XCUIDevice.shared.press(.home)
        let away = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.messages.state != .runningForeground }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [away], timeout: 30 * Self.pace), .completed, "[NATIVE-UI-RESUME-02] Messages left the foreground")
        try control.shiftBet("bet-a", to: "revealed")
        XCTAssertEqual(try state(of: "bet-a"), "revealed", "[NATIVE-UI-RESUME-02] fixture: the product's sweep revealed the bet")
        let reads = try extensionCalls("v0Bets:")

        // Messages comes back without a relaunch, so the conversation and its link are the ones Finn left.
        XCTAssertTrue([.runningBackground, .runningBackgroundSuspended].contains(messages.state), "[NATIVE-UI-RESUME-03] Messages is still running, state \(messages.state.rawValue)")
        messages.activate()
        XCTAssertTrue(messages.wait(for: .runningForeground, timeout: 60 * Self.pace), "[NATIVE-UI-RESUME-03] Messages returns to the foreground without a relaunch")
        try showExtensionAgain("NATIVE-UI-RESUME-03")
        print("J5-EXPLORE resume: bet.screen=\(element("bet.screen", in: messages).exists) board=\(element("navigation.board", in: messages).exists) openGroup=\(labelled("Open group", in: messages, timeout: 0, quiet: true)) home=\(labelled("Home", in: messages, timeout: 0, quiet: true)) link=\(labelled("Link this conversation", in: messages, timeout: 0, quiet: true))")
        XCTAssertFalse(element("bet.confirmPick", in: messages).exists, "[NATIVE-UI-RESUME-04] no pick control from before the reveal is shown on return")
        XCTAssertFalse(element("bet.option.0", in: messages).exists, "[NATIVE-UI-RESUME-04]")

        try openGroupHome("NATIVE-UI-RESUME-05")
        assertLabelContains(try required("group.bet." + betID("bet-a"), in: messages, "NATIVE-UI-RESUME-05"), "Revealed", "NATIVE-UI-RESUME-05")
        let after = try openBet("bet-a")
        assertLabel(try required("bet.state", in: after, "NATIVE-UI-RESUME-06"), "Revealed", "NATIVE-UI-RESUME-06")
        XCTAssertFalse(element("bet.confirmPick", in: after).exists, "[NATIVE-UI-RESUME-07] no pick after the reveal")
        assertText("QA Cora", in: after, "NATIVE-UI-RESUME-08")
        assertText("Confidence 60 / 100", in: after, "NATIVE-UI-RESUME-08")
        XCTAssertGreaterThan(try extensionCalls("v0Bets:"), reads, "[NATIVE-UI-RESUME-09] what is shown on return was read from the server after the return")
        XCTAssertEqual(try control.rows("picks").count, 1, "[NATIVE-UI-RESUME-10] nothing was picked for Finn")
    }

    // MARK: J5.2 minority, tie, majority

    func testAMinorityAndATieLetTheAnswerStandAndAMajorityVoids() throws {
        // Oli joins G1 as a long-standing member, so a bet about Sage can have three pickers.
        try control.call("seedMember", ["group": "G1", "actor": "oli"])
        try seedRevealedBet("minority", question: "Will the minority fixture stand", alsoPicking: ["oli"])
        try seedRevealedBet("tie", question: "Will the tie fixture stand")
        try seedRevealedBet("majority", question: "Will the majority fixture void", alsoPicking: ["oli"])
        for key in ["minority", "tie", "majority"] { try answer(key, option: 0) }
        XCTAssertNil(try control.act("cora", "mutation", "v0Bets:challenge", ["betId": "@bet:majority", "requestId": "cora-challenge-majority"]), "[NATIVE-UI-TALLY-00] fixture: Cora challenges the majority bet")

        // Finn challenges each answer on screen: 1 of 3 pickers, 1 of 2, and with Cora 2 of 3.
        try start(as: .finn)
        for key in ["minority", "tie", "majority"] {
            let screen = try openBet(key)
            assertText("Provisional: Yes", in: screen, "NATIVE-UI-TALLY-01")
            try tap("bet.challenge", in: screen)
            assertGone(element("bet.challenge", in: screen), "NATIVE-UI-TALLY-01")
            try goHome()
        }
        let challenges = try control.rows("challenges")
        XCTAssertEqual(challenges.count, 4, "[NATIVE-UI-TALLY-02] Finn's three challenges and Cora's one are on the server")
        XCTAssertEqual(challenges.filter { $0["actor"] as? String == "finn" }.count, 3, "[NATIVE-UI-TALLY-02]")
        for key in ["minority", "tie", "majority"] {
            XCTAssertEqual(try state(of: key), "provisional", "[NATIVE-UI-TALLY-03] nothing is decided before the hour ends, also with a majority already in: \(key)")
        }
        XCTAssertEqual(try control.rows("ledger").count, 0, "[NATIVE-UI-TALLY-03] nothing is scored during the hour")

        // The hour ends for one bet at a time; a voided bet between two results leaves the streak alone.
        try control.shiftBet("minority", to: "challengeOver")
        try control.shiftBet("majority", to: "challengeOver")
        try control.shiftBet("tie", to: "challengeOver")
        XCTAssertEqual(try state(of: "minority"), "finalized", "[NATIVE-UI-TALLY-04] 1 of 3 is a minority: the answer stands")
        XCTAssertEqual(try state(of: "tie"), "finalized", "[NATIVE-UI-TALLY-05] 1 of 2 is a tie: the answer stands")
        XCTAssertEqual(try state(of: "majority"), "voided", "[NATIVE-UI-TALLY-06] 2 of 3 is a majority: the bet is voided")
        XCTAssertEqual(try bet("minority")["outcome"] as? Int, 0, "[NATIVE-UI-TALLY-04] the subject's answer is the result")
        XCTAssertEqual(try bet("tie")["outcome"] as? Int, 0, "[NATIVE-UI-TALLY-05]")
        XCTAssertEqual(try ledger(for: "minority").count, 3, "[NATIVE-UI-TALLY-07] every picker on the minority bet is scored")
        XCTAssertEqual(try ledger(for: "tie").count, 2, "[NATIVE-UI-TALLY-07]")
        XCTAssertEqual(try ledger(for: "majority").count, 0, "[NATIVE-UI-TALLY-07] a voided bet scores nobody")

        // The board: Finn 80 then 80 x 1.1, Oli 50 for the one result, Cora wrong twice.
        try tap("navigation.board", in: messages)
        let finn = try required("board.row." + accountID(.finn), in: messages, "NATIVE-UI-TALLY-08")
        assertLabelContains(finn, "168 pts", "NATIVE-UI-TALLY-08")
        assertLabelContains(finn, "Streak 2", "NATIVE-UI-TALLY-08")
        assertLabelContains(try required("board.row." + accountID(.oli), in: messages, "NATIVE-UI-TALLY-08"), "50 pts", "NATIVE-UI-TALLY-08")
        let points = Dictionary(uniqueKeysWithValues: try control.rows("memberships").filter { $0["group"] as? String == "G1" }.map { ($0["actor"] as? String ?? "", $0["points"] as? Int ?? -1) })
        XCTAssertEqual(points, ["finn": 168, "oli": 50, "cora": 0, "sage": 0], "[NATIVE-UI-TALLY-08] the board shows what the server holds")

        try goHome()
        assertLabelContains(try required("group.bet." + betID("minority"), in: messages, "NATIVE-UI-TALLY-09"), "Finalized", "NATIVE-UI-TALLY-09")
        assertLabelContains(try required("group.bet." + betID("tie"), in: messages, "NATIVE-UI-TALLY-09"), "Finalized", "NATIVE-UI-TALLY-09")
        assertLabelContains(try required("group.bet." + betID("majority"), in: messages, "NATIVE-UI-TALLY-09"), "Card unavailable", "NATIVE-UI-TALLY-09")
        for key in ["minority", "tie"] {
            let screen = try openBet(key)
            assertText("Final result: Yes", in: screen, "NATIVE-UI-TALLY-10")
            XCTAssertFalse(element("bet.challenge", in: screen).exists, "[NATIVE-UI-TALLY-10] no challenge after the result")
            try goHome()
        }
        try openBet("majority")
        _ = try required("bet.unavailable", in: messages, "NATIVE-UI-TALLY-11")
        XCTAssertFalse(text("Final result: Yes", in: messages).exists, "[NATIVE-UI-TALLY-11] a voided bet shows no result")
    }

    // MARK: J5.2 deadline and exactly-once finalize

    func testTheOpenScreenFollowsTheServerWhenTheChallengeHourEnds() throws {
        try seedRevealedBet()
        try answer("bet-a", option: 0)
        XCTAssertNil(try control.act("cora", "mutation", "v0Bets:challenge", ["betId": "@bet:bet-a", "requestId": "cora-challenge"]), "[NATIVE-UI-DEADLINE-00] fixture: Cora challenges inside the hour")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        assertText("Provisional: Yes", in: screen, "NATIVE-UI-DEADLINE-01")
        _ = try required("bet.challenge", in: screen, "NATIVE-UI-DEADLINE-01")
        XCTAssertFalse(element("bet.sendResult", in: screen).exists, "[NATIVE-UI-DEADLINE-01] no result during the hour")

        // The hour ends on the server while the screen is open. Nobody touches the screen.
        try control.shiftBet("bet-a", to: "challengeOver")
        assertText("Final result: Yes", in: screen, "NATIVE-UI-DEADLINE-02", timeout: 30)
        assertGone(element("bet.challenge", in: screen), "NATIVE-UI-DEADLINE-03")
        _ = try required("bet.sendResult", in: screen, "NATIVE-UI-DEADLINE-03")

        // A challenge that arrives after the deadline is refused. Had it counted, 2 of 2 would have voided the bet.
        XCTAssertEqual(try control.act("finn", "mutation", "v0Bets:challenge", ["betId": "@bet:bet-a", "requestId": "finn-late-challenge"]), "NOT_AVAILABLE", "[NATIVE-UI-DEADLINE-04] the server refuses a challenge after the hour")
        XCTAssertEqual(try control.rows("challenges").count, 1, "[NATIVE-UI-DEADLINE-04] only the challenge made inside the hour is stored")
        XCTAssertEqual(try appCalls("v0Bets:challenge"), 0, "[NATIVE-UI-DEADLINE-04] the app itself sent no challenge")

        // The finalizer runs again, twice. The result, the ledger and the result notifications stay as they were.
        XCTAssertEqual(try ledger(for: "bet-a").count, 2, "[NATIVE-UI-ONCE-01] one ledger row per pick")
        XCTAssertEqual(try outbox("result"), 3, "[NATIVE-UI-ONCE-01] one result notification each for the subject and the two pickers")
        try control.runJob("sweep")
        try control.runJob("sweep")
        XCTAssertEqual(try state(of: "bet-a"), "finalized", "[NATIVE-UI-ONCE-02] still final")
        XCTAssertEqual(try bet("bet-a")["outcome"] as? Int, 0, "[NATIVE-UI-ONCE-02]")
        let rows = try ledger(for: "bet-a")
        XCTAssertEqual(rows.count, 2, "[NATIVE-UI-ONCE-03] no second ledger row")
        XCTAssertEqual(rows.first { $0["actor"] as? String == "finn" }?["points"] as? Int, 80, "[NATIVE-UI-ONCE-03]")
        XCTAssertEqual(try outbox("result"), 3, "[NATIVE-UI-ONCE-04] no second result notification")
        let membership = try control.rows("memberships").first { $0["actor"] as? String == "finn" && $0["group"] as? String == "G1" }
        XCTAssertEqual(membership?["points"] as? Int, 80, "[NATIVE-UI-ONCE-05] the points are credited once")
        XCTAssertEqual(membership?["streak"] as? Int, 1, "[NATIVE-UI-ONCE-05]")

        try goHome()
        try tap("navigation.board", in: messages)
        let finn = try required("board.row." + accountID(.finn), in: messages, "NATIVE-UI-ONCE-06")
        assertLabelContains(finn, "80 pts", "NATIVE-UI-ONCE-06")
        assertLabelContains(finn, "Streak 1", "NATIVE-UI-ONCE-06")
        try goHome()
        let reopened = try openBet("bet-a")
        assertText("Final result: Yes", in: reopened, "NATIVE-UI-ONCE-07")
    }

    // MARK: J5.3 late answer and single terminal state

    func testATimedOutBetIsVoidOnceAndALateAnswerIsRefused() throws {
        try seedRevealedBet()
        try start(as: .sage)
        let screen = try openBet("bet-a")
        try tap("bet.revealWithoutRubbing", in: screen)
        _ = try required("bet.answer.0", in: screen, "NATIVE-UI-LATE-01")
        _ = try required("bet.answer.1", in: screen, "NATIVE-UI-LATE-01")
        // Where a proof upload would be offered to the subject, V0 offers none and says nothing about proof.
        assertText(answerFootnote, in: screen, "NATIVE-UI-NOPROOF-01")
        try assertNoProofSurface("NATIVE-UI-NOPROOF-01")

        // The 24 hours end on the server while the answer buttons are on screen. Nobody touches the screen.
        try control.shiftBet("bet-a", to: "answerTimeout")
        XCTAssertEqual(try state(of: "bet-a"), "voided", "[NATIVE-UI-LATE-02] fixture: the product's sweep voided the bet")
        _ = try required("bet.unavailable", in: messages, timeout: 30, "NATIVE-UI-LATE-03")
        assertGone(element("bet.answer.0", in: messages), "NATIVE-UI-LATE-04")
        assertGone(element("bet.answer.1", in: messages), "NATIVE-UI-LATE-04")

        // The subject's answer arrives after the worker: refused, and the bet stays as the worker left it.
        XCTAssertEqual(try control.act("sage", "mutation", "v0Bets:answer", ["betId": "@bet:bet-a", "option": 0, "requestId": "sage-late-answer"]), "NOT_AVAILABLE", "[NATIVE-UI-LATE-05] the server refuses an answer after the timeout")
        XCTAssertEqual(try appCalls("v0Bets:answer"), 0, "[NATIVE-UI-LATE-05] the app itself sent no answer")
        try control.runJob("sweep")
        try control.runJob("sweep")
        let saved = try bet("bet-a")
        XCTAssertEqual(saved["state"] as? String, "voided", "[NATIVE-UI-TERMINAL-01] voided is final")
        XCTAssertNil(saved["provisionalOutcome"] as? Int, "[NATIVE-UI-TERMINAL-01] no answer is stored")
        XCTAssertNil(saved["outcome"] as? Int, "[NATIVE-UI-TERMINAL-01] no result is stored")
        XCTAssertEqual(try control.rows("ledger").count, 0, "[NATIVE-UI-TERMINAL-02] nobody is scored")
        let picks = try control.rows("picks")
        XCTAssertEqual(picks.count, 2, "[NATIVE-UI-TERMINAL-03]")
        XCTAssertTrue(picks.allSatisfy { $0["voided"] as? Bool == true }, "[NATIVE-UI-TERMINAL-03] every pick is voided")
        XCTAssertEqual(try outbox("result"), 0, "[NATIVE-UI-TERMINAL-04] a voided bet sends no result notification")
        XCTAssertTrue(try control.rows("memberships").allSatisfy { $0["points"] as? Int == 0 && $0["streak"] as? Int == 0 }, "[NATIVE-UI-TERMINAL-05] no points and no streak changed")

        try goHome()
        assertLabelContains(try required("group.bet." + betID("bet-a"), in: messages, "NATIVE-UI-TERMINAL-06"), "Card unavailable", "NATIVE-UI-TERMINAL-06")
        try openBet("bet-a")
        _ = try required("bet.unavailable", in: messages, "NATIVE-UI-TERMINAL-07")
        XCTAssertFalse(element("bet.answer.0", in: messages).exists, "[NATIVE-UI-TERMINAL-07] no answer is offered after the timeout")
    }

    // MARK: J5.5 cancel truth

    func testPreparingAResultCardThatIsNotSentClaimsNoDelivery() throws {
        try seedRevealedBet()
        try answer("bet-a", option: 0)
        try control.shiftBet("bet-a", to: "challengeOver")
        XCTAssertEqual(try state(of: "bet-a"), "finalized", "[NATIVE-UI-CANCEL-00] fixture: the product's sweep finalized the bet")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        let prepare = try required("bet.sendResult", in: screen, "NATIVE-UI-CANCEL-01")
        assertLabel(prepare, "Prepare result card", "NATIVE-UI-CANCEL-01")
        assertText(resultFootnote, in: screen, "NATIVE-UI-CANCEL-01")
        // Where a friend would open the subject's proof, V0 offers nothing.
        try assertNoProofSurface("NATIVE-UI-NOPROOF-02")
        let said = try statements(on: screen)
        XCTAssertTrue(said.contains("Final result: Yes"), "[NATIVE-UI-CANCEL-01] the screen was read while it showed the result: \(said)")
        let saved = try bet("bet-a")
        let outboxBefore = try control.rows("outbox").count
        let writes = { try self.control.calls().filter { $0["kind"] as? String != "query" }.count }
        let writesBefore = try writes()

        // Preparing puts a draft card in the message field. Sending is the person's own tap in Messages.
        try tap(prepare, scrolling: messages)
        let draft = messages.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Secret bet on QA Sage")).firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-CANCEL-02] the draft card is in the message field")
        print("J5-EXPLORE draft:\n" + messages.debugDescription + "\nJ5-EXPLORE end")

        // The draft is never sent. The app recorded nothing, and says exactly what it said before.
        try showExtensionAgain("NATIVE-UI-CANCEL-04")
        try openGroupHome("NATIVE-UI-CANCEL-04")
        let reopened = try openBet("bet-a")
        _ = try required("bet.sendResult", in: reopened, "NATIVE-UI-CANCEL-05")
        assertText("Final result: Yes", in: reopened, "NATIVE-UI-CANCEL-05")
        XCTAssertEqual(try statements(on: reopened), said, "[NATIVE-UI-CANCEL-05] the screen claims nothing it did not claim before the draft")
        XCTAssertEqual(reopened.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", "delivered")).count, 0, "[NATIVE-UI-CANCEL-06] nothing says a card was delivered")
        XCTAssertFalse(text("Link this conversation to the card's group before sending.", in: messages).exists, "[NATIVE-UI-CANCEL-06] preparing did not fail")
        XCTAssertEqual(try writes(), writesBefore, "[NATIVE-UI-CANCEL-07] preparing a card tells the server nothing")
        XCTAssertEqual(try control.rows("outbox").count, outboxBefore, "[NATIVE-UI-CANCEL-07]")
        let now = try bet("bet-a")
        XCTAssertEqual(now["state"] as? String, saved["state"] as? String, "[NATIVE-UI-CANCEL-08] the bet is unchanged")
        XCTAssertEqual(now["outcome"] as? Int, saved["outcome"] as? Int, "[NATIVE-UI-CANCEL-08]")
    }
}
