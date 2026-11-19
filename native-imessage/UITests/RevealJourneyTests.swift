import XCTest

/// Journey 5: the reveal, the subject's answer, the challenge hour, the result and the timeout.
final class RevealJourneyTests: JourneyCase {
    private func seedPickedBet() throws {
        try control.seedBet("bet-a", format: "yes_no")
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 0, "confidence": 0.8, "requestId": "finn-pick"]))
        XCTAssertNil(try control.act("cora", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 1, "confidence": 0.6, "requestId": "cora-pick"]))
    }

    func testSubjectRevealsWithoutRubbingAndAnswers() throws {
        try seedPickedBet()
        try control.shiftBet("bet-a", to: "revealed")
        try start(as: .sage)
        let row = try required("group.bet." + betID("bet-a"), in: messages)
        XCTAssertTrue(row.label.contains("Revealed"), "[NATIVE-UI-REVEAL-01] \(row.label)")
        let screen = try openBet("bet-a")
        let reveal = try required("bet.revealWithoutRubbing", in: screen, "NATIVE-UI-REVEAL-02")
        XCTAssertFalse(element("bet.answer.0", in: screen).exists, "[NATIVE-UI-REVEAL-03] no answer buttons while the question is covered")
        try tap(reveal)
        assertText(run.secretQuestion, in: screen, "NATIVE-UI-REVEAL-04")
        assertGone(element("bet.revealWithoutRubbing", in: screen), "NATIVE-UI-REVEAL-05")
        XCTAssertFalse(element("bet.confirmPick", in: screen).exists, "[NATIVE-UI-REVEAL-06] the subject never picks")
        assertText("QA Finn", in: screen, "NATIVE-UI-REVEAL-07")
        assertText("QA Cora", in: screen, "NATIVE-UI-REVEAL-07")
        assertText("Confidence 80 / 100", in: screen, "NATIVE-UI-REVEAL-07")
        assertLabel(try required("bet.answer.0", in: screen), "Yes", "NATIVE-UI-ANSWER-01")
        assertLabel(try required("bet.answer.1", in: screen), "No", "NATIVE-UI-ANSWER-01")

        try tap("bet.answer.0", in: screen)
        assertText("Awaiting the group", in: screen, "NATIVE-UI-ANSWER-02")
        assertText("Provisional: Yes", in: screen, "NATIVE-UI-ANSWER-03")
        assertGone(element("bet.answer.0", in: screen), "NATIVE-UI-ANSWER-04")
        XCTAssertFalse(element("bet.challenge", in: screen).exists, "[NATIVE-UI-ANSWER-05] the subject cannot challenge their own answer")
        let saved = try bet("bet-a")
        XCTAssertEqual(saved["state"] as? String, "provisional", "[NATIVE-UI-ANSWER-06]")
        XCTAssertEqual(saved["provisionalOutcome"] as? Int, 0, "[NATIVE-UI-ANSWER-06]")
        XCTAssertEqual(try control.rows("ledger").count, 0, "[NATIVE-UI-ANSWER-07] nothing is scored during the challenge hour")
        XCTAssertEqual(try appCalls("v0Bets:answer"), 1, "[NATIVE-UI-ANSWER-08]")
    }

    func testCoveredQuestionIsNotExposedToAccessibility() throws {
        try seedPickedBet()
        try control.shiftBet("bet-a", to: "revealed")
        try start(as: .sage)
        let screen = try openBet("bet-a")
        _ = try required("bet.revealWithoutRubbing", in: screen)
        XCTAssertFalse(text(run.secretQuestion, in: screen).exists, "[NATIVE-UI-REVEAL-08] the question is covered until the subject reveals it")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-REVEAL-08")
        // Two accessible ways in that need no rub: the cover is announced as a button (its activate action cannot be
        // driven from a UI test, which only sends touches), and a plain button below it does the same.
        _ = try labelled("Covered by invisible ink", in: screen)
        try tap("bet.revealWithoutRubbing", in: screen)
        assertText(run.secretQuestion, in: screen, "NATIVE-UI-REVEAL-09")
    }

    func testFriendChallengesOnceDuringTheHour() throws {
        try seedPickedBet()
        try control.shiftBet("bet-a", to: "revealed")
        XCTAssertNil(try control.act("sage", "mutation", "v0Bets:answer", ["betId": "@bet:bet-a", "option": 1, "requestId": "sage-answer"]))
        try start(as: .finn)
        let screen = try openBet("bet-a")
        assertText("Provisional: No", in: screen, "NATIVE-UI-CHALLENGE-01")
        assertLabel(try required("bet.question", in: screen), run.secretQuestion, "NATIVE-UI-CHALLENGE-01")
        try tap("bet.challenge", in: screen)
        assertGone(element("bet.challenge", in: screen), "NATIVE-UI-CHALLENGE-02")
        let challenges = try control.rows("challenges")
        XCTAssertEqual(challenges.count, 1, "[NATIVE-UI-CHALLENGE-03] one challenge on the server")
        XCTAssertEqual(challenges.first?["actor"] as? String, "finn", "[NATIVE-UI-CHALLENGE-03]")
        XCTAssertEqual(try bet("bet-a")["state"] as? String, "provisional", "[NATIVE-UI-CHALLENGE-04] one of two pickers is not a majority")
        XCTAssertEqual(try appCalls("v0Bets:challenge"), 1, "[NATIVE-UI-CHALLENGE-05]")
    }

    func testResultAndPointsAppearAfterTheChallengeHour() throws {
        try seedPickedBet()
        try control.shiftBet("bet-a", to: "revealed")
        XCTAssertNil(try control.act("sage", "mutation", "v0Bets:answer", ["betId": "@bet:bet-a", "option": 0, "requestId": "sage-answer"]))
        try control.shiftBet("bet-a", to: "challengeOver")
        XCTAssertEqual(try bet("bet-a")["state"] as? String, "finalized", "[NATIVE-UI-RESULT-00] fixture: the product's sweep finalized the bet")
        try start(as: .finn)
        let row = try required("group.bet." + betID("bet-a"), in: messages)
        XCTAssertTrue(row.label.contains("Finalized"), "[NATIVE-UI-RESULT-01] \(row.label)")
        let screen = try openBet("bet-a")
        assertText("Final result: Yes", in: screen, "NATIVE-UI-RESULT-02")
        _ = try required("bet.sendResult", in: screen, "NATIVE-UI-RESULT-03")
        XCTAssertFalse(element("bet.challenge", in: screen).exists, "[NATIVE-UI-RESULT-04] no challenge after the result")
        XCTAssertFalse(element("bet.confirmPick", in: screen).exists, "[NATIVE-UI-RESULT-04]")
        try goHome()
        assertText("You're QA Finn · 80 group points · streak 1", in: messages, "NATIVE-UI-RESULT-05")
        try tap("navigation.board", in: messages)
        let finn = try required("board.row." + accountID(.finn), in: messages, "NATIVE-UI-RESULT-06")
        XCTAssertTrue(finn.label.contains("80 pts") && finn.label.contains("Streak 1"), "[NATIVE-UI-RESULT-06] \(finn.label)")
        let cora = try required("board.row." + accountID(.cora), in: messages)
        XCTAssertTrue(cora.label.contains("0 pts"), "[NATIVE-UI-RESULT-07] a wrong pick earns nothing and loses nothing: \(cora.label)")
        let ledger = try control.rows("ledger")
        XCTAssertEqual(ledger.count, 2, "[NATIVE-UI-RESULT-08] one ledger row per pick")
        XCTAssertEqual(ledger.first(where: { $0["actor"] as? String == "finn" })?["points"] as? Int, 80, "[NATIVE-UI-RESULT-08]")
        XCTAssertEqual(ledger.first(where: { $0["actor"] as? String == "cora" })?["points"] as? Int, 0, "[NATIVE-UI-RESULT-08]")
    }

    func testMajorityChallengeVoidsTheBet() throws {
        try seedPickedBet()
        try control.shiftBet("bet-a", to: "revealed")
        XCTAssertNil(try control.act("sage", "mutation", "v0Bets:answer", ["betId": "@bet:bet-a", "option": 0, "requestId": "sage-answer"]))
        XCTAssertNil(try control.act("cora", "mutation", "v0Bets:challenge", ["betId": "@bet:bet-a", "requestId": "cora-challenge"]))
        try start(as: .finn)
        let screen = try openBet("bet-a")
        try tap("bet.challenge", in: screen)
        assertGone(element("bet.challenge", in: screen), "NATIVE-UI-VOID-01")
        try control.shiftBet("bet-a", to: "challengeOver")
        _ = try required("bet.unavailable", in: messages, timeout: 20, "NATIVE-UI-VOID-02")
        XCTAssertEqual(try bet("bet-a")["state"] as? String, "voided", "[NATIVE-UI-VOID-03]")
        XCTAssertEqual(try control.rows("ledger").count, 0, "[NATIVE-UI-VOID-04] a voided bet scores nobody")
    }

    func testUnansweredBetBecomesUnavailable() throws {
        try seedPickedBet()
        try control.shiftBet("bet-a", to: "answerTimeout")
        XCTAssertEqual(try bet("bet-a")["state"] as? String, "voided", "[NATIVE-UI-TIMEOUT-00] fixture: the product's sweep voided the bet")
        try start(as: .sage)
        let row = try required("group.bet." + betID("bet-a"), in: messages)
        XCTAssertTrue(row.label.contains("Card unavailable"), "[NATIVE-UI-TIMEOUT-01] \(row.label)")
        try openBet("bet-a")
        _ = try required("bet.unavailable", in: messages, "NATIVE-UI-TIMEOUT-02")
        XCTAssertFalse(element("bet.answer.0", in: messages).exists, "[NATIVE-UI-TIMEOUT-03] no answer after the deadline")
        XCTAssertEqual(try control.rows("ledger").count, 0, "[NATIVE-UI-TIMEOUT-04]")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-TIMEOUT-05")
    }
}
