import XCTest

/// Journeys 3 and 4, the rules around a pick: who the worker names for the daily turn, a confirmation that fails or
/// arrives late, the ends of the confidence range, two devices of one person, and what the subject and a friend see
/// of a sealed and of a vetoed bet. V0 has no edit of a confirmed pick and no stake; the legacy stake routes are
/// retired and the app has no screen for them, so those cases are asserted here only as "nothing can change a pick".
final class PickRulesJourneyTests: JourneyCase {
    private let unreachable = "Couldn't complete this request. Check your connection and try again."
    private let refused = "This isn't available to your account. An earlier card may be outside your membership."
    private let unverified = "Confirmation hasn't been verified. Retry the same pick or refresh; editing stays disabled until it is resolved."

    /// Waits until the screen shows a condition.
    private func shows(_ code: String, _ what: String, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line, _ condition: @escaping () -> Bool) {
        let reached = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [reached], timeout: timeout * Self.pace), .completed, "[\(code)] \(what)", file: file, line: line)
    }

    /// Drafts a side and taps Confirm while the gateway fails the pick request and the two quiet repeats the app makes,
    /// so no request reaches the server. Ends on the screen's unverified state.
    private func confirmWhileTheServerCannotBeReached(option: Int, in screen: XCUIElement, alreadyInjected: Int = 0, _ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        try control.failNext("v0Bets:pick", count: 3)
        try choose(option: option, in: screen, file: file, line: line)
        try tap("bet.confirmPick", in: screen, file: file, line: line)
        assertLabel(try required("bet.confirmationPending", in: screen, code, file: file, line: line), unverified, code, file: file, line: line)
        XCTAssertEqual(try appCalls("v0Bets:pick", outcome: "injected"), alreadyInjected + 3, "[\(code)] the request and its two quiet repeats all failed before the server", file: file, line: line)
        XCTAssertEqual(try appCalls("v0Bets:pick"), 0, "[\(code)] no pick request has succeeded", file: file, line: line)
    }

    private func pick(on key: String) throws -> [[String: Any]] {
        try control.rows("picks").filter { $0["bet"] as? String == key }
    }

    /// What one fixture person is given for a bet by the real read handler.
    private func view(of key: String, as actor: String, _ code: String) throws -> [String: Any] {
        let reply = try control.call("act", ["actor": actor, "kind": "query", "path": "v0Bets:get", "args": ["locator": "@locator:" + key]]) as? [String: Any]
        guard reply?["ok"] as? Bool == true, let value = reply?["value"] as? [String: Any] else {
            XCTFail("[\(code)] \(actor) could not read the bet")
            throw Blocked()
        }
        return value
    }

    /// The seconds the sealed card says are left, read from its "Reveals <time> · h:mm:ss" line.
    private func secondsLeft(in screen: XCUIElement) -> Int? {
        let line = screen.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Reveals ")).firstMatch
        guard line.exists else { return nil }
        let parts = (line.label.components(separatedBy: " · ").last ?? "").split(separator: ":").compactMap { Int($0) }
        return parts.count == 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : nil
    }

    // MARK: J3.1

    func testTheWorkerNamesTheFriendWhoWaitedLongestAndTheCreatorSeesThatFriend() throws {
        // G2 in join order is Cora, Finn, Oli. Finn was the subject of an earlier bet and Oli never was.
        try control.seedBet("g2-earlier", group: "G2", creator: "oli", subject: "finn")
        // G1 in join order is Cora, Sage, Finn. Sage has "no bets about me" on.
        XCTAssertNil(try control.act("sage", "mutation", "v0Controls:update", ["noBets": true, "blockedTopics": [String](), "hostedAiConsent": false, "requestId": "sage-no-bets"]), "[NATIVE-UI-ROTATE-01]")
        try control.runJob("turns")
        try control.runJob("turns")

        let turns = try control.rows("turns")
        XCTAssertEqual(turns.count, 2, "[NATIVE-UI-ROTATE-02] the worker run twice leaves one turn for each group")
        let first = turns.first(where: { $0["group"] as? String == "G1" })
        let second = turns.first(where: { $0["group"] as? String == "G2" })
        XCTAssertEqual(first?["creator"] as? String, "cora", "[NATIVE-UI-ROTATE-03] the first member in join order creates")
        XCTAssertEqual(first?["subject"] as? String, "finn", "[NATIVE-UI-ROTATE-03] a member with no bets about me is skipped as subject")
        XCTAssertEqual(second?["creator"] as? String, "cora", "[NATIVE-UI-ROTATE-04] the first member in join order creates")
        XCTAssertEqual(second?["subject"] as? String, "oli", "[NATIVE-UI-ROTATE-04] the member who has never been the subject goes before one who has")
        XCTAssertEqual(first?["status"] as? String, "assigned", "[NATIVE-UI-ROTATE-05]")
        XCTAssertEqual(second?["status"] as? String, "assigned", "[NATIVE-UI-ROTATE-05]")

        try start(as: .cora, in: "G2")
        assertText("Your creator turn", in: messages, "NATIVE-UI-ROTATE-06")
        try tap("turn.create", in: messages)
        _ = try required("compose.subject", in: messages, "NATIVE-UI-ROTATE-07")
        let named = messages.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "QA Oli", "QA Oli")).firstMatch
        XCTAssertTrue(named.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-ROTATE-07] the new bet is about the friend the worker named")
        XCTAssertEqual(try control.rows("turns").count, 2, "[NATIVE-UI-ROTATE-08] opening the form changes no turn")
    }

    // MARK: J3.2 and J3.3

    func testAConfirmationTheServerNeverGotIsNotShownAsSaved() throws {
        try control.seedBet("bet-a", format: "yes_no")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        try confirmWhileTheServerCannotBeReached(option: 1, in: screen, "NATIVE-UI-OFFLINE-01")
        assertText(unreachable, in: messages, "NATIVE-UI-OFFLINE-02")
        XCTAssertFalse(element("bet.confirmedPick", in: messages).exists, "[NATIVE-UI-OFFLINE-03] a failed confirmation is not shown as confirmed")
        XCTAssertFalse(element("bet.savedPick", in: messages).exists, "[NATIVE-UI-OFFLINE-03] a failed confirmation is not shown as saved")
        XCTAssertFalse(element("bet.saveConfirmation", in: messages).exists, "[NATIVE-UI-OFFLINE-03]")
        XCTAssertFalse(try required("bet.option.0", in: screen).isEnabled, "[NATIVE-UI-OFFLINE-04] the draft cannot be edited while its confirmation is unverified")
        XCTAssertFalse(try required("bet.confidence", in: screen).isEnabled, "[NATIVE-UI-OFFLINE-04]")
        XCTAssertEqual(try control.rows("picks").count, 0, "[NATIVE-UI-OFFLINE-05] nothing is saved on the server")

        // Leave and come back: the bet is read again and still shows no pick, only a new draft.
        try goHome()
        let reopened = try openBet("bet-a")
        _ = try required("bet.confirmPick", in: reopened, "NATIVE-UI-OFFLINE-06")
        XCTAssertFalse(element("bet.confirmedPick", in: messages).exists, "[NATIVE-UI-OFFLINE-06] reopening does not turn the failed draft into a pick")
        XCTAssertFalse(element("bet.savedPick", in: messages).exists, "[NATIVE-UI-OFFLINE-06]")

        // Fail once more, then retry the same confirmation: it is saved exactly once.
        try confirmWhileTheServerCannotBeReached(option: 1, in: reopened, alreadyInjected: 3, "NATIVE-UI-OFFLINE-07")
        try tap("bet.retryConfirmation", in: reopened)
        _ = try required("bet.confirmedPick", in: reopened, "NATIVE-UI-OFFLINE-08")
        assertLabel(try required("bet.savedPick", in: reopened), "No · confidence 50 / 100", "NATIVE-UI-OFFLINE-08")
        assertLabel(try required("bet.saveConfirmation", in: reopened), "The server confirmed and locked your pick.", "NATIVE-UI-OFFLINE-08")
        assertGone(text(unreachable, in: messages), "NATIVE-UI-OFFLINE-09")
        XCTAssertEqual(try appCalls("v0Bets:pick"), 1, "[NATIVE-UI-OFFLINE-10] one pick request reached the server")
        var picks = try control.rows("picks")
        XCTAssertEqual(picks.count, 1, "[NATIVE-UI-OFFLINE-10] exactly one pick")
        XCTAssertEqual(picks.first?["actor"] as? String, "finn", "[NATIVE-UI-OFFLINE-10]")
        XCTAssertEqual(picks.first?["option"] as? Int, 1, "[NATIVE-UI-OFFLINE-10]")
        XCTAssertEqual(picks.first?["confidence"] as? Double, 0.5, "[NATIVE-UI-OFFLINE-10]")

        // The same pick sent again under a new request, as a second phone would, adds nothing.
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 1, "confidence": 0.5, "requestId": "finn-same-pick-again"]), "[NATIVE-UI-OFFLINE-11]")
        picks = try control.rows("picks")
        XCTAssertEqual(picks.count, 1, "[NATIVE-UI-OFFLINE-11] a repeated confirmation is not a second pick")
        XCTAssertEqual(picks.first?["confidence"] as? Double, 0.5, "[NATIVE-UI-OFFLINE-11] and its confidence is not added up")
    }

    func testThePickTheServerAcceptedReplacesAnUnverifiedDraftAndCannotBeChanged() throws {
        try control.seedBet("bet-a", format: "yes_no")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        // This phone's Yes at 50 never reaches the server. Finn's other device then confirms No at 80.
        try confirmWhileTheServerCannotBeReached(option: 0, in: screen, "NATIVE-UI-RACE-01")
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 1, "confidence": 0.8, "requestId": "finn-other-device"]), "[NATIVE-UI-RACE-02]")

        assertLabel(try required("bet.savedPick", in: screen, timeout: 30, "NATIVE-UI-RACE-03"), "No · confidence 80 / 100", "NATIVE-UI-RACE-03")
        _ = try required("bet.confirmedPick", in: screen, "NATIVE-UI-RACE-03")
        assertGone(element("bet.retryConfirmation", in: messages), "NATIVE-UI-RACE-04")
        assertGone(element("bet.confirmationPending", in: messages), "NATIVE-UI-RACE-04")
        XCTAssertFalse(element("bet.confirmPick", in: messages).exists, "[NATIVE-UI-RACE-05] the confirmed pick cannot be confirmed again")
        XCTAssertFalse(element("bet.option.0", in: messages).exists, "[NATIVE-UI-RACE-05] the confirmed pick has no edit control")
        XCTAssertFalse(element("bet.confidence", in: messages).exists, "[NATIVE-UI-RACE-05]")
        XCTAssertEqual(try appCalls("v0Bets:pick"), 0, "[NATIVE-UI-RACE-06] this phone's draft was never accepted")

        // Neither side nor confidence of the accepted pick can be changed from any device.
        XCTAssertEqual(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 0, "confidence": 0.8, "requestId": "finn-change-side"]), "CONFLICT", "[NATIVE-UI-RACE-07]")
        XCTAssertEqual(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 1, "confidence": 0.9, "requestId": "finn-change-confidence"]), "CONFLICT", "[NATIVE-UI-RACE-07]")
        let picks = try control.rows("picks")
        XCTAssertEqual(picks.count, 1, "[NATIVE-UI-RACE-08] one pick for this bet and person")
        XCTAssertEqual(picks.first?["option"] as? Int, 1, "[NATIVE-UI-RACE-08] the first accepted side stands")
        XCTAssertEqual(picks.first?["confidence"] as? Double, 0.8, "[NATIVE-UI-RACE-08] the first accepted confidence stands")

        try goHome()
        let reopened = try openBet("bet-a")
        assertLabel(try required("bet.savedPick", in: reopened), "No · confidence 80 / 100", "NATIVE-UI-RACE-09")
        XCTAssertFalse(element("bet.confirmPick", in: messages).exists, "[NATIVE-UI-RACE-09]")
    }

    func testConfidenceEndsAtOneAndAtOneHundred() throws {
        try control.seedBet("bet-low", format: "yes_no")
        try control.seedBet("bet-high", format: "yes_no")
        try start(as: .finn)

        let low = try openBet("bet-low")
        try choose(option: 0, in: low)
        try required("bet.confidence", in: low).adjust(toNormalizedSliderPosition: 0)
        assertText("Confidence: 1 / 100", in: low, "NATIVE-UI-BOUNDS-01")
        try tap("bet.confirmPick", in: low)
        assertLabel(try required("bet.savedPick", in: low), "Yes · confidence 1 / 100", "NATIVE-UI-BOUNDS-02")
        XCTAssertEqual(try pick(on: "bet-low").first?["confidence"] as? Double, 0.01, "[NATIVE-UI-BOUNDS-02] the lowest confidence the screen offers is 1%")

        try goHome()
        let high = try openBet("bet-high")
        try choose(option: 1, in: high)
        try required("bet.confidence", in: high).adjust(toNormalizedSliderPosition: 1)
        assertText("Confidence: 100 / 100", in: high, "NATIVE-UI-BOUNDS-03")
        try tap("bet.confirmPick", in: high)
        assertLabel(try required("bet.savedPick", in: high), "No · confidence 100 / 100", "NATIVE-UI-BOUNDS-04")
        XCTAssertEqual(try pick(on: "bet-high").first?["confidence"] as? Double, 1, "[NATIVE-UI-BOUNDS-04] the highest confidence the screen offers is 100%")
        XCTAssertEqual(try pick(on: "bet-high").first?["option"] as? Int, 1, "[NATIVE-UI-BOUNDS-04]")

        // Outside the range, a third choice, or a stake: the server refuses each and saves nothing.
        let outside: [(String, [String: Any])] = [
            ("zero", ["option": 0, "confidence": 0]), ("below", ["option": 0, "confidence": 0.009]), ("above", ["option": 0, "confidence": 1.01]),
            ("third-choice", ["option": 2, "confidence": 0.5]), ("stake", ["option": 0, "confidence": 0.5, "riskPoints": 10]),
        ]
        for (name, values) in outside {
            var arguments = values
            arguments["betId"] = "@bet:bet-low"
            arguments["requestId"] = "cora-" + name
            XCTAssertEqual(try control.act("cora", "mutation", "v0Bets:pick", arguments), "INVALID_INPUT", "[NATIVE-UI-BOUNDS-05] \(name)")
        }
        let picks = try control.rows("picks")
        XCTAssertEqual(picks.count, 2, "[NATIVE-UI-BOUNDS-06] only the two picks made on the screen exist")
        XCTAssertTrue(picks.allSatisfy { $0["actor"] as? String == "finn" }, "[NATIVE-UI-BOUNDS-06]")
        XCTAssertEqual(try appCalls("v0Bets:pick"), 2, "[NATIVE-UI-BOUNDS-06]")
    }

    // MARK: J3.4

    func testAConfirmationThatArrivesAfterTheRevealIsRefused() throws {
        try control.seedBet("bet-a", format: "yes_no")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        // The pick was tapped before the reveal but never reached the server; the retry is sent after the reveal.
        try confirmWhileTheServerCannotBeReached(option: 0, in: screen, "NATIVE-UI-LATE-01")
        try control.shiftBet("bet-a", to: "revealed")
        try tap("bet.retryConfirmation", in: screen)

        assertLabel(try required("bet.state", in: screen, "NATIVE-UI-LATE-02"), "Revealed", "NATIVE-UI-LATE-02")
        assertText(refused, in: messages, "NATIVE-UI-LATE-03")
        assertGone(element("bet.retryConfirmation", in: messages), "NATIVE-UI-LATE-04")
        XCTAssertFalse(element("bet.confirmedPick", in: messages).exists, "[NATIVE-UI-LATE-05] a late confirmation is not shown as confirmed")
        XCTAssertFalse(element("bet.savedPick", in: messages).exists, "[NATIVE-UI-LATE-05] a late confirmation is not shown as saved")
        XCTAssertFalse(element("bet.saveConfirmation", in: messages).exists, "[NATIVE-UI-LATE-05]")
        XCTAssertFalse(element("bet.confirmPick", in: messages).exists, "[NATIVE-UI-LATE-05] no pick is offered after the reveal")
        XCTAssertEqual(try appCalls("v0Bets:pick", outcome: "NOT_AVAILABLE"), 1, "[NATIVE-UI-LATE-06] the retry reached the server and was refused")
        XCTAssertEqual(try appCalls("v0Bets:pick"), 0, "[NATIVE-UI-LATE-06]")
        XCTAssertEqual(try control.act("cora", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 1, "confidence": 0.5, "requestId": "cora-after-reveal"]), "NOT_AVAILABLE", "[NATIVE-UI-LATE-07] another member's pick after the reveal is refused too")
        XCTAssertEqual(try control.rows("picks").count, 0, "[NATIVE-UI-LATE-08] no pick was saved at or after the reveal")
        XCTAssertEqual(try control.rows("ledger").count, 0, "[NATIVE-UI-LATE-08]")
    }

    // MARK: J4.2

    func testTheSealedCardCountsDownToTheServersRevealAndShowsWhoIsIn() throws {
        try control.seedBet("bet-a", format: "this_that")
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 0, "confidence": 0.8, "requestId": "finn-pick"]))
        try start(as: .sage)
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.sealed", in: screen, "NATIVE-UI-SEALED-01"), "Hidden bet about QA Sage", "NATIVE-UI-SEALED-01")

        shows("NATIVE-UI-SEALED-02", "the sealed card shows a countdown") { self.secondsLeft(in: screen) != nil }
        guard let first = secondsLeft(in: screen), let revealAt = try bet("bet-a")["revealAt"] as? Double else {
            return XCTFail("[NATIVE-UI-SEALED-02] the countdown or the bet's reveal time could not be read")
        }
        let expected = revealAt / 1000 - Date().timeIntervalSince1970
        XCTAssertGreaterThan(first, 0, "[NATIVE-UI-SEALED-03] time is left before the reveal")
        XCTAssertEqual(Double(first), expected, accuracy: 20, "[NATIVE-UI-SEALED-03] the countdown runs to the server's reveal time")
        shows("NATIVE-UI-SEALED-04", "the countdown goes down by itself", timeout: 10) { (self.secondsLeft(in: screen) ?? first) < first }

        assertText("1 friends are in", in: screen, "NATIVE-UI-SEALED-05")
        assertText("Q", in: screen, "NATIVE-UI-SEALED-05")
        XCTAssertNil(try control.act("cora", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 1, "confidence": 0.6, "requestId": "cora-pick"]))
        assertText("2 friends are in", in: screen, "NATIVE-UI-SEALED-06", timeout: 30)
        assertText("Q · Q", in: screen, "NATIVE-UI-SEALED-06")

        _ = try required("bet.sealed", in: screen, "NATIVE-UI-SEALED-07")
        XCTAssertFalse(element("bet.question", in: messages).exists, "[NATIVE-UI-SEALED-07] no question before the reveal")
        XCTAssertFalse(element("bet.revealWithoutRubbing", in: messages).exists, "[NATIVE-UI-SEALED-07] nothing offers to uncover the card before the reveal")
        XCTAssertFalse(element("bet.option.0", in: messages).exists, "[NATIVE-UI-SEALED-07] the card shows how many are in, never a side")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-SEALED-08")
    }

    // MARK: J4.3

    func testAVetoedBetOpensAsANeutralUnavailableCard() throws {
        try control.seedBet("bet-a", format: "yes_no")
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 0, "confidence": 0.8, "requestId": "finn-pick"]))
        try start(as: .finn)
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.savedPick", in: screen), "Yes · confidence 80 / 100", "NATIVE-UI-OLDCARD-01")

        // The subject vetoes on her own phone while Finn has the bet open.
        XCTAssertNil(try control.act("sage", "mutation", "v0Bets:veto", ["betId": "@bet:bet-a", "requestId": "sage-veto"]), "[NATIVE-UI-OLDCARD-02]")
        _ = try required("bet.unavailable", in: messages, timeout: 30, "NATIVE-UI-OLDCARD-03")
        assertText("This card isn't available", in: messages, "NATIVE-UI-OLDCARD-03")
        assertGone(element("bet.question", in: messages), "NATIVE-UI-OLDCARD-04")
        assertGone(element("bet.savedPick", in: messages), "NATIVE-UI-OLDCARD-04")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-OLDCARD-05")
        XCTAssertFalse(try visibleContent(of: messages).lowercased().contains("veto"), "[NATIVE-UI-OLDCARD-05] the screen does not say the bet was vetoed, or by whom")

        // Opened again from the group's list, it is the same neutral card.
        try goHome()
        let row = try required("group.bet." + betID("bet-a"), in: messages, "NATIVE-UI-OLDCARD-06")
        XCTAssertTrue(row.label.contains("Card unavailable"), "[NATIVE-UI-OLDCARD-06] the list names no question: \(row.label)")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-OLDCARD-06")
        try tap(row, scrolling: messages)
        _ = try required("bet.unavailable", in: messages, "NATIVE-UI-OLDCARD-07")
        XCTAssertFalse(element("bet.question", in: messages).exists, "[NATIVE-UI-OLDCARD-07]")
        XCTAssertFalse(element("bet.confirmPick", in: messages).exists, "[NATIVE-UI-OLDCARD-07] nothing can be picked on a vetoed bet")
        XCTAssertFalse(try visibleContent(of: messages).lowercased().contains("veto"), "[NATIVE-UI-OLDCARD-07]")

        // The creator and the subject are given the same neutral card by the server.
        for actor in ["cora", "sage"] {
            let value = try view(of: "bet-a", as: actor, "NATIVE-UI-OLDCARD-08")
            XCTAssertEqual(value["view"] as? String, "unavailable", "[NATIVE-UI-OLDCARD-08] \(actor)")
            XCTAssertNil(value["question"], "[NATIVE-UI-OLDCARD-08] \(actor)")
            let wire = String(data: try JSONSerialization.data(withJSONObject: value), encoding: .utf8) ?? ""
            XCTAssertFalse(wire.isEmpty || wire.lowercased().contains("veto") || wire.contains(run.secretQuestion), "[NATIVE-UI-OLDCARD-08] \(actor) is told nothing about the veto or the question")
        }
        XCTAssertEqual(try bet("bet-a")["state"] as? String, "voided", "[NATIVE-UI-OLDCARD-09]")
        XCTAssertEqual(try control.rows("picks").first?["voided"] as? Bool, true, "[NATIVE-UI-OLDCARD-09] the friend's pick is voided")
        XCTAssertEqual(try control.rows("ledger").count, 0, "[NATIVE-UI-OLDCARD-09] nothing is scored")
        let id = try betID("bet-a")
        XCTAssertEqual(try control.rows("outbox").filter { $0["betId"] as? String == id }.count, 0, "[NATIVE-UI-OLDCARD-10] nothing is queued to announce it")
    }
}
