import XCTest

/// Journey 3: it is someone's turn, a bet exists, and a friend picks.
final class PickJourneyTests: JourneyCase {
    func testFriendConfirmsOnePickThatPersists() throws {
        try control.seedBet("bet-a", format: "yes_no")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.question", in: screen), run.secretQuestion, "NATIVE-UI-PICK-01")
        assertLabel(try required("bet.option.0", in: screen), "Yes", "NATIVE-UI-FORMAT-01")
        assertLabel(try required("bet.option.1", in: screen), "No", "NATIVE-UI-FORMAT-01")
        XCTAssertEqual(try control.rows("picks").count, 0, "[NATIVE-UI-PICK-02] nothing is saved before the confirm tap")

        let started = ProcessInfo.processInfo.systemUptime
        try choose(option: 1, in: screen)
        try tap("bet.confirmPick", in: screen)
        _ = try required("bet.confirmedPick", in: screen, "NATIVE-UI-PICK-03")
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - started, 10, "[NATIVE-UI-PICK-04] confirmed within ten seconds of the first tap")
        assertLabel(try required("bet.savedPick", in: screen), "No · confidence 50 / 100", "NATIVE-UI-PICK-05")
        assertLabel(try required("bet.saveConfirmation", in: screen), "The server confirmed and locked your pick.", "NATIVE-UI-PICK-06")
        XCTAssertFalse(element("bet.confirmPick", in: screen).exists, "[NATIVE-UI-PICK-07] a confirmed pick cannot be confirmed again")
        XCTAssertFalse(element("bet.option.0", in: screen).exists, "[NATIVE-UI-PICK-07] a confirmed pick cannot be edited")

        let picks = try control.rows("picks")
        XCTAssertEqual(picks.count, 1, "[NATIVE-UI-PICK-08] exactly one pick on the server")
        XCTAssertEqual(picks.first?["actor"] as? String, "finn", "[NATIVE-UI-PICK-08]")
        XCTAssertEqual(picks.first?["option"] as? Int, 1, "[NATIVE-UI-PICK-08]")
        XCTAssertEqual(picks.first?["confidence"] as? Double, 0.5, "[NATIVE-UI-PICK-08]")
        XCTAssertEqual(try appCalls("v0Bets:pick"), 1, "[NATIVE-UI-PICK-09] one pick request, no duplicate")

        // Leave the bet and come back: the pick is read from the server again, not kept in the view.
        // Blocked on a simulator: the same check after quitting Messages. The simulator's Messages reports a new
        // conversation identity on every launch (two fingerprints seen in one run), so the group link does not survive it.
        let reads = try appCalls("v0Bets:get")
        try tap(labelled("Home", in: messages))
        let reopened = try openBet("bet-a")
        assertLabel(try required("bet.savedPick", in: reopened), "No · confidence 50 / 100", "NATIVE-UI-PICK-10")
        XCTAssertGreaterThan(try appCalls("v0Bets:get"), reads, "[NATIVE-UI-PICK-10] the reopened bet was read from the server")
        XCTAssertEqual(try control.rows("picks").count, 1, "[NATIVE-UI-PICK-10] still one pick after reopening")
    }

    func testConfidenceShownIsTheConfidenceSaved() throws {
        try control.seedBet("bet-a", format: "yes_no")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        try choose(option: 0, in: screen)
        let slider = try required("bet.confidence", in: screen)
        slider.adjust(toNormalizedSliderPosition: 0.9)
        try tap("bet.confirmPick", in: screen)
        let saved = try required("bet.savedPick", in: screen)
        guard let stored = try control.rows("picks").first?["confidence"] as? Double, stored >= 0.6, stored <= 1 else {
            return XCTFail("[NATIVE-UI-CONF-01] the server did not store the raised confidence")
        }
        XCTAssertEqual(stored * 100, (stored * 100).rounded(), accuracy: 0.000001, "[NATIVE-UI-CONF-02] confidence is a whole number of points")
        assertLabel(saved, "Yes · confidence \(Int((stored * 100).rounded())) / 100", "NATIVE-UI-CONF-03")
    }

    func testOverUnderShowsItsLineChoices() throws {
        try control.seedBet("bet-a", format: "over_under")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.option.0", in: screen), "Over 2.5", "NATIVE-UI-FORMAT-02")
        assertLabel(try required("bet.option.1", in: screen), "Under 2.5", "NATIVE-UI-FORMAT-02")
        try choose(option: 0, in: screen)
        try tap("bet.confirmPick", in: screen)
        assertLabel(try required("bet.savedPick", in: screen), "Over 2.5 · confidence 50 / 100", "NATIVE-UI-FORMAT-03")
    }

    func testThisThatShowsBothChoices() throws {
        try control.seedBet("bet-a", format: "this_that")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.option.0", in: screen), "PRIVATE_OPTION_A_" + run.manifest.runID, "NATIVE-UI-FORMAT-04")
        assertLabel(try required("bet.option.1", in: screen), "PRIVATE_OPTION_B_" + run.manifest.runID, "NATIVE-UI-FORMAT-04")
        try choose(option: 1, in: screen)
        try tap("bet.confirmPick", in: screen)
        assertLabel(try required("bet.savedPick", in: screen), "PRIVATE_OPTION_B_" + run.manifest.runID + " · confidence 50 / 100", "NATIVE-UI-FORMAT-05")
    }

    func testNoPickIsOfferedAfterTheReveal() throws {
        try control.seedBet("bet-a", format: "yes_no")
        try control.shiftBet("bet-a", to: "revealed")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.state", in: screen), "Revealed", "NATIVE-UI-CUTOFF-01")
        XCTAssertFalse(element("bet.confirmPick", in: screen).exists, "[NATIVE-UI-CUTOFF-02] no pick control after the reveal")
        XCTAssertFalse(element("bet.option.0", in: screen).exists, "[NATIVE-UI-CUTOFF-02]")
        XCTAssertEqual(try control.rows("picks").count, 0, "[NATIVE-UI-CUTOFF-03]")
    }

    func testOnlyTodaysCreatorIsOfferedTheTurn() throws {
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        try start(as: .finn)
        assertText("Today's creator turn", in: messages, "NATIVE-UI-TURN-01")
        XCTAssertFalse(element("turn.create", in: messages).exists, "[NATIVE-UI-TURN-02] a member who is not today's creator cannot start today's bet")
        XCTAssertFalse(text("Your creator turn", in: messages).exists, "[NATIVE-UI-TURN-02]")
    }

    func testCreatorPassesTheTurnOnce() throws {
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        try start(as: .cora)
        assertText("Your creator turn", in: messages, "NATIVE-UI-TURN-03")
        _ = try required("turn.create", in: messages, "NATIVE-UI-TURN-03")
        try tap("turn.pass", in: messages)
        assertText("Today's creator turn", in: messages, "NATIVE-UI-TURN-04")
        assertGone(element("turn.create", in: messages), "NATIVE-UI-TURN-05")
        assertGone(element("turn.pass", in: messages), "NATIVE-UI-TURN-05")
        let turns = try control.rows("turns")
        XCTAssertEqual(turns.count, 1, "[NATIVE-UI-TURN-06] still one turn for the day")
        XCTAssertEqual(turns.first?["status"] as? String, "passed", "[NATIVE-UI-TURN-06]")
        XCTAssertNotEqual(turns.first?["creator"] as? String, "cora", "[NATIVE-UI-TURN-06] the turn moved to someone else")
        XCTAssertEqual(try appCalls("v0Groups:passTurn"), 1, "[NATIVE-UI-TURN-07]")
    }
}
