import XCTest

/// Journey 7: the approved scoring rules as the screens show them. Every result here is produced by the product's own
/// pick, answer and sweep handlers on the loopback backend; the tests read it back on the home line, the group list,
/// the board, its history and the shared goal, and compare with the server's ledger.
final class ScoringJourneyTests: JourneyCase {
    private typealias Pick = (actor: String, option: Int, confidence: Double)

    /// One fixture bet from picks to its final result: the fixture people pick through the public handler, the subject
    /// answers, and the product's sweep finalizes it after the challenge hour.
    private func settle(_ key: String, group: String = "G1", creator: String = "cora", subject: String = "sage", question: String, picks: [Pick], answer: Int = 0, file: StaticString = #filePath, line: UInt = #line) throws {
        try control.seedBet(key, group: group, creator: creator, subject: subject, question: question)
        for pick in picks {
            XCTAssertNil(try control.act(pick.actor, "mutation", "v0Bets:pick", ["betId": "@bet:" + key, "option": pick.option, "confidence": pick.confidence, "requestId": key + "-pick-" + pick.actor]), "[NATIVE-UI-SCORE-00] fixture: \(pick.actor) picks on \(key)", file: file, line: line)
        }
        try control.shiftBet(key, to: "revealed")
        XCTAssertNil(try control.act(subject, "mutation", "v0Bets:answer", ["betId": "@bet:" + key, "option": answer, "requestId": key + "-answer"]), "[NATIVE-UI-SCORE-00] fixture: \(subject) answers \(key)", file: file, line: line)
        try control.shiftBet(key, to: "challengeOver")
        XCTAssertEqual(try bet(key)["state"] as? String, "finalized", "[NATIVE-UI-SCORE-00] fixture: the product's sweep finalized \(key)", file: file, line: line)
    }

    /// One person's ledger lines in the order they were written, as "bet:points:streakBefore>streakAfter".
    private func ledger(_ actor: String, group: String = "G1") throws -> [String] {
        try control.rows("ledger").filter { $0["actor"] as? String == actor && $0["group"] as? String == group }.map {
            "\($0["bet"] as? String ?? "?"):\($0["points"] as? Int ?? -1):\($0["streakBefore"] as? Int ?? -1)>\($0["streakAfter"] as? Int ?? -1)"
        }
    }

    /// One person's stored balance in one group, as "points/streak".
    private func balance(_ actor: String, group: String = "G1") throws -> String {
        let row = try control.rows("memberships").first { $0["actor"] as? String == actor && $0["group"] as? String == group }
        return "\(row?["points"] as? Int ?? -1)/\(row?["streak"] as? Int ?? -1)"
    }

    /// A board row, once it shows every one of the given parts.
    @discardableResult
    private func boardRow(_ actor: Actor, shows parts: [String], _ code: String, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        let row = try required("board.row." + accountID(actor), in: messages, timeout: 15, code, file: file, line: line)
        let shown = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in parts.allSatisfy { row.label.contains($0) } }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: 15 * Self.pace), .completed, "[\(code)] expected \(parts) in \"\(row.exists ? row.label : "nothing")\"", file: file, line: line)
        return row
    }

    private func history(_ key: String) throws -> XCUIElement {
        element("board.history." + (try betID(key)), in: messages)
    }

    /// Leaves the board and opens it again, which loads it from the server again.
    private func reopenBoard(file: StaticString = #filePath, line: UInt = #line) throws {
        try goHome(file: file, line: line)
        try tap("navigation.board", in: messages, file: file, line: line)
    }

    func testApprovedPointsAndStreaksReachEveryScreen() throws {
        // Finn: 70% right, then 35% right on a streak of one (35 x 1.1 = 38.5, which rounds up to 39), then 45% right on a
        // streak of two (45 x 1.2 = 54). Cora: 1% right, then 100% wrong, then 100% right with her streak back at zero.
        try settle("bet-1", question: "Synthetic question one", picks: [("finn", 0, 0.7), ("cora", 0, 0.01)])
        try settle("bet-2", question: "Synthetic question two", picks: [("finn", 0, 0.35), ("cora", 1, 1)])
        try settle("bet-3", question: "Synthetic question three", picks: [("finn", 0, 0.45), ("cora", 0, 1)])
        XCTAssertEqual(try ledger("finn"), ["bet-1:70:0>1", "bet-2:39:1>2", "bet-3:54:2>3"], "[NATIVE-UI-SCORE-01] the server's ledger for Finn")
        XCTAssertEqual(try ledger("cora"), ["bet-1:1:0>1", "bet-2:0:1>0", "bet-3:100:0>1"], "[NATIVE-UI-SCORE-01] the server's ledger for Cora")

        try signIn(.finn)
        // The host app is for signing in and notifications. It has no score of its own that could disagree.
        let hostScores = host.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] 'group points' OR label CONTAINS[c] ' pts' OR label CONTAINS[c] 'streak'"))
        XCTAssertEqual(hostScores.count, 0, "[NATIVE-UI-SCORE-02] the host app shows no points or streak")
        try openExtension()
        try link("G1")

        assertText("You're QA Finn · 163 group points · streak 3", in: messages, "NATIVE-UI-SCORE-03")
        try tap("navigation.board", in: messages)
        let finn = try boardRow(.finn, shows: ["Rank 1", "QA Finn", "163 pts", "Streak 3"], "NATIVE-UI-SCORE-04")
        let cora = try boardRow(.cora, shows: ["Rank 2", "QA Cora", "101 pts", "Streak 1"], "NATIVE-UI-SCORE-04")
        let sage = try boardRow(.sage, shows: ["Rank 3", "QA Sage", "0 pts", "Streak 0"], "NATIVE-UI-SCORE-04")
        XCTAssertTrue(finn.frame.minY < cora.frame.minY && cora.frame.minY < sage.frame.minY, "[NATIVE-UI-SCORE-05] ranked by points")
        assertText("Correct calls earn 1–100 confidence points × the streak bonus. Wrong calls earn zero without reducing points.", in: messages, "NATIVE-UI-SCORE-06")
        XCTAssertEqual(messages.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'rules are confirmed' OR label CONTAINS[c] 'awaiting'")).count, 0, "[NATIVE-UI-SCORE-06] the board does not call the approved rules undecided")

        try goHome()
        try tap("navigation.groups", in: messages)
        assertText("163 points · streak 3", in: messages, "NATIVE-UI-SCORE-07", timeout: 15)
        XCTAssertEqual(try balance("finn"), "163/3", "[NATIVE-UI-SCORE-08] the stored balance is what the home line, the board and the group list show")
        XCTAssertEqual(try balance("cora"), "101/1", "[NATIVE-UI-SCORE-08]")
        XCTAssertEqual(try balance("sage"), "0/0", "[NATIVE-UI-SCORE-08] the subject never scores")
    }

    func testTiedMembersShareARankAndAreListedByName() throws {
        // Sage starts on 70. Finn and Cora each earn 70 from one bet, so all three are level. They joined in the order
        // Cora, Sage, Finn, which is not the order of their names.
        try control.reset(points: ["G1": ["sage": 70]])
        try settle("bet-1", question: "Synthetic question one", picks: [("finn", 0, 0.7), ("cora", 0, 0.7)])
        try start(as: .finn)
        try tap("navigation.board", in: messages)
        var cora = try boardRow(.cora, shows: ["Rank 1", "70 pts"], "NATIVE-UI-TIE-01")
        var finn = try boardRow(.finn, shows: ["Rank 1", "70 pts"], "NATIVE-UI-TIE-01")
        var sage = try boardRow(.sage, shows: ["Rank 1", "70 pts"], "NATIVE-UI-TIE-01")
        XCTAssertTrue(cora.frame.minY < finn.frame.minY && finn.frame.minY < sage.frame.minY, "[NATIVE-UI-TIE-02] level members are listed by name")

        // Finn pulls ahead (50% right on a streak of one is 55). Cora and Sage stay level behind him.
        try settle("bet-2", question: "Synthetic question two", picks: [("finn", 0, 0.5), ("cora", 1, 0.5)])
        try reopenBoard()
        finn = try boardRow(.finn, shows: ["Rank 1", "125 pts"], "NATIVE-UI-TIE-03")
        cora = try boardRow(.cora, shows: ["Rank 2", "70 pts"], "NATIVE-UI-TIE-03")
        sage = try boardRow(.sage, shows: ["Rank 2", "70 pts"], "NATIVE-UI-TIE-03")
        XCTAssertTrue(finn.frame.minY < cora.frame.minY && cora.frame.minY < sage.frame.minY, "[NATIVE-UI-TIE-04] by points, then by name")
        XCTAssertEqual(try [balance("finn"), balance("cora"), balance("sage")], ["125/2", "70/0", "70/0"], "[NATIVE-UI-TIE-05] the server holds the same balances")
    }

    func testVoidedAndMissedBetsLeaveTheStreakAlone() throws {
        try settle("bet-1", question: "Synthetic question one", picks: [("finn", 0, 0.7)])
        // Nobody answers: voided after 24 hours.
        try control.seedBet("bet-2", question: "Synthetic question two")
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-2", "option": 0, "confidence": 0.9, "requestId": "bet-2-pick-finn"]))
        XCTAssertNil(try control.act("cora", "mutation", "v0Bets:pick", ["betId": "@bet:bet-2", "option": 0, "confidence": 0.9, "requestId": "bet-2-pick-cora"]))
        try control.shiftBet("bet-2", to: "answerTimeout")
        XCTAssertEqual(try bet("bet-2")["state"] as? String, "voided", "[NATIVE-UI-VOIDSTREAK-00] fixture: the unanswered bet is voided")
        // Both pickers challenge the answer: voided when the hour ends.
        try control.seedBet("bet-3", question: "Synthetic question three")
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-3", "option": 0, "confidence": 0.8, "requestId": "bet-3-pick-finn"]))
        XCTAssertNil(try control.act("cora", "mutation", "v0Bets:pick", ["betId": "@bet:bet-3", "option": 0, "confidence": 0.6, "requestId": "bet-3-pick-cora"]))
        try control.shiftBet("bet-3", to: "revealed")
        XCTAssertNil(try control.act("sage", "mutation", "v0Bets:answer", ["betId": "@bet:bet-3", "option": 0, "requestId": "bet-3-answer"]))
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:challenge", ["betId": "@bet:bet-3", "requestId": "bet-3-challenge-finn"]))
        XCTAssertNil(try control.act("cora", "mutation", "v0Bets:challenge", ["betId": "@bet:bet-3", "requestId": "bet-3-challenge-cora"]))
        try control.shiftBet("bet-3", to: "challengeOver")
        XCTAssertEqual(try bet("bet-3")["state"] as? String, "voided", "[NATIVE-UI-VOIDSTREAK-00] fixture: the challenged bet is voided")
        // Finn does not pick on the fourth bet, and Cora does not pick on the fifth.
        try settle("bet-4", question: "Synthetic question four", picks: [("cora", 0, 0.5)])
        try settle("bet-5", question: "Synthetic question five", picks: [("finn", 0, 0.5)])
        XCTAssertEqual(try ledger("finn"), ["bet-1:70:0>1", "bet-5:55:1>2"], "[NATIVE-UI-VOIDSTREAK-01] no ledger line for a voided or missed bet, and the streak carried across them")
        XCTAssertEqual(try ledger("cora"), ["bet-4:50:0>1"], "[NATIVE-UI-VOIDSTREAK-01]")

        try start(as: .finn)
        assertText("You're QA Finn · 125 group points · streak 2", in: messages, "NATIVE-UI-VOIDSTREAK-02")
        for key in ["bet-2", "bet-3"] {
            let row = try required("group.bet." + betID(key), in: messages, "NATIVE-UI-VOIDSTREAK-03")
            XCTAssertTrue(row.label.contains("Card unavailable") && row.label.contains("Voided"), "[NATIVE-UI-VOIDSTREAK-03] \(row.label)")
        }
        try tap("navigation.board", in: messages)
        try boardRow(.finn, shows: ["Rank 1", "125 pts", "Streak 2"], "NATIVE-UI-VOIDSTREAK-04")
        try boardRow(.cora, shows: ["Rank 2", "50 pts", "Streak 1"], "NATIVE-UI-VOIDSTREAK-04")
        for key in ["bet-1", "bet-4", "bet-5"] {
            XCTAssertTrue(try history(key).waitForExistence(timeout: 15 * Self.pace), "[NATIVE-UI-VOIDSTREAK-05] the final history lists \(key)")
        }
        for key in ["bet-2", "bet-3"] {
            XCTAssertFalse(try history(key).exists, "[NATIVE-UI-VOIDSTREAK-06] a voided bet has no result in the final history")
        }
    }

    func testAFinalResultIsCreditedExactlyOnce() throws {
        try control.seedBet("bet-1", question: "Synthetic question one")
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-1", "option": 0, "confidence": 0.8, "requestId": "bet-1-pick-finn"]))
        XCTAssertNil(try control.act("cora", "mutation", "v0Bets:pick", ["betId": "@bet:bet-1", "option": 1, "confidence": 0.6, "requestId": "bet-1-pick-cora"]))
        try control.shiftBet("bet-1", to: "revealed")
        let answer: [String: Any] = ["betId": "@bet:bet-1", "option": 0, "requestId": "bet-1-answer"]
        XCTAssertNil(try control.act("sage", "mutation", "v0Bets:answer", answer))
        XCTAssertNil(try control.act("sage", "mutation", "v0Bets:answer", answer), "[NATIVE-UI-ONCE-00] fixture: a retried answer returns the stored one")
        try control.shiftBet("bet-1", to: "challengeOver")
        XCTAssertEqual(try control.act("sage", "mutation", "v0Bets:answer", ["betId": "@bet:bet-1", "option": 1, "requestId": "bet-1-answer-late"]), "NOT_AVAILABLE", "[NATIVE-UI-ONCE-00] fixture: a final result takes no new answer")
        try control.runJob("sweep")
        try control.runJob("sweep")
        XCTAssertEqual(try control.rows("ledger").count, 2, "[NATIVE-UI-ONCE-01] one ledger line per pick after three sweeps")

        try start(as: .finn)
        assertText("You're QA Finn · 80 group points · streak 1", in: messages, "NATIVE-UI-ONCE-02")
        let screen = try openBet("bet-1")
        assertText("Final result: Yes", in: screen, "NATIVE-UI-ONCE-03")
        try reopenBoard()
        try boardRow(.finn, shows: ["80 pts", "Streak 1"], "NATIVE-UI-ONCE-04")
        try boardRow(.cora, shows: ["0 pts", "Streak 0"], "NATIVE-UI-ONCE-04")
        XCTAssertTrue(try history("bet-1").waitForExistence(timeout: 15 * Self.pace), "[NATIVE-UI-ONCE-05]")

        // The sweep runs again while the app is open, and the app reads the result and the board again.
        try control.runJob("sweep")
        try reopenBoard()
        try boardRow(.finn, shows: ["80 pts", "Streak 1"], "NATIVE-UI-ONCE-06")
        try boardRow(.cora, shows: ["0 pts", "Streak 0"], "NATIVE-UI-ONCE-06")
        XCTAssertEqual(messages.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "board.history.")).count, 1, "[NATIVE-UI-ONCE-07] the result is in the history once")
        XCTAssertEqual(try ledger("finn"), ["bet-1:80:0>1"], "[NATIVE-UI-ONCE-08]")
        XCTAssertEqual(try ledger("cora"), ["bet-1:0:0>0"], "[NATIVE-UI-ONCE-08]")
        XCTAssertEqual(try [balance("finn"), balance("cora")], ["80/1", "0/0"], "[NATIVE-UI-ONCE-08]")
        XCTAssertGreaterThanOrEqual(try appCalls("v0Groups:board"), 2, "[NATIVE-UI-ONCE-09] the app loaded the board again")
    }

    func testEachGroupKeepsItsOwnHistoryAndPoints() throws {
        // Cora starts on 60 in G2. She then wins in G1 and loses in G2.
        try control.reset(points: ["G2": ["cora": 60]])
        try settle("bet-g1", question: "Synthetic question for group one", picks: [("cora", 0, 0.8)])
        try settle("bet-g2", group: "G2", creator: "finn", subject: "oli", question: "Synthetic question for group two", picks: [("cora", 0, 0.6)], answer: 1)
        try start(as: .cora)
        assertText("You're QA Cora · 80 group points · streak 1", in: messages, "NATIVE-UI-GROUPS-01")
        try tap("navigation.board", in: messages)
        try boardRow(.cora, shows: ["80 pts", "Streak 1"], "NATIVE-UI-GROUPS-02")
        let first = try history("bet-g1")
        XCTAssertTrue(first.waitForExistence(timeout: 15 * Self.pace), "[NATIVE-UI-GROUPS-03] this group's result is in its history")
        XCTAssertTrue(first.label.contains("Synthetic question for group one") && first.label.contains("Yes"), "[NATIVE-UI-GROUPS-03] \(first.label)")
        XCTAssertFalse(try history("bet-g2").exists, "[NATIVE-UI-GROUPS-04] the other group's result is not here")
        XCTAssertFalse(text("Synthetic question for group two", in: messages).exists, "[NATIVE-UI-GROUPS-04]")

        // The group list shows one balance per group and no total across them.
        try goHome()
        try tap("navigation.groups", in: messages)
        assertText("80 points · streak 1", in: messages, "NATIVE-UI-GROUPS-05", timeout: 15)
        assertText("60 points · streak 0", in: messages, "NATIVE-UI-GROUPS-05")
        XCTAssertEqual(messages.staticTexts.matching(NSPredicate(format: "label CONTAINS ' points · streak '")).count, 2, "[NATIVE-UI-GROUPS-06] one balance for each of the two groups and nothing else")
        XCTAssertEqual(messages.staticTexts.matching(NSPredicate(format: "label CONTAINS '140 points' OR label CONTAINS '140 group points' OR label CONTAINS '140 pts'")).count, 0, "[NATIVE-UI-GROUPS-06] no balance added up across groups")

        try tap("group.unlink", in: messages)
        try tap("group.link." + groupID("G2"), in: messages, timeout: 15)
        assertText("You're QA Cora · 60 group points · streak 0", in: messages, "NATIVE-UI-GROUPS-07")
        try tap("navigation.board", in: messages, timeout: 15)
        try boardRow(.cora, shows: ["60 pts", "Streak 0"], "NATIVE-UI-GROUPS-08")
        let second = try history("bet-g2")
        XCTAssertTrue(second.waitForExistence(timeout: 15 * Self.pace), "[NATIVE-UI-GROUPS-09]")
        XCTAssertTrue(second.label.contains("Synthetic question for group two") && second.label.contains("No"), "[NATIVE-UI-GROUPS-09] \(second.label)")
        XCTAssertFalse(try history("bet-g1").exists, "[NATIVE-UI-GROUPS-10]")
        XCTAssertFalse(text("Synthetic question for group one", in: messages).exists, "[NATIVE-UI-GROUPS-10]")
        XCTAssertEqual(try ledger("cora", group: "G1"), ["bet-g1:80:0>1"], "[NATIVE-UI-GROUPS-11]")
        XCTAssertEqual(try ledger("cora", group: "G2"), ["bet-g2:0:0>0"], "[NATIVE-UI-GROUPS-11]")
        XCTAssertEqual(try [balance("cora", group: "G1"), balance("cora", group: "G2")], ["80/1", "60/0"], "[NATIVE-UI-GROUPS-12] one balance per group on the server")
    }

    func testGroupPointsMoveTheSharedGoal() throws {
        // Finn's 120 points were earned before the goal existed and do not count toward it.
        try control.reset(points: ["G1": ["finn": 120]])
        XCTAssertNil(try control.act("finn", "mutation", "v0Groups:proposeGoal", ["groupId": "@G1", "label": "Synthetic dinner", "targetPoints": 150, "requestId": "finn-goal"]))
        XCTAssertNil(try control.act("cora", "mutation", "v0Groups:confirmGoal", ["groupId": "@G1", "requestId": "cora-confirm"]))
        XCTAssertEqual(try control.rows("goals").first?["state"] as? String, "confirmed", "[NATIVE-UI-PROGRESS-00] fixture: two of three members made the goal active")
        try settle("bet-1", question: "Synthetic question one", picks: [("finn", 0, 0.8), ("cora", 1, 0.6)])

        try start(as: .cora)
        try tap("navigation.board", in: messages)
        assertText("Synthetic dinner", in: messages, "NATIVE-UI-PROGRESS-01", timeout: 15)
        assertText("80 / 150 points · confirmed", in: messages, "NATIVE-UI-PROGRESS-02")
        XCTAssertFalse(labelled("Confirm shared goal", in: messages, timeout: 1, quiet: true), "[NATIVE-UI-PROGRESS-03] an active goal asks for no confirmation")
        try boardRow(.finn, shows: ["200 pts"], "NATIVE-UI-PROGRESS-04")

        // Both score on the next bet: Finn 55 on his streak, Cora 50. The group has now earned 185 since the goal began.
        try settle("bet-2", question: "Synthetic question two", picks: [("finn", 0, 0.5), ("cora", 0, 0.5)])
        try reopenBoard()
        assertText("185 / 150 points · reached", in: messages, "NATIVE-UI-PROGRESS-05")
        try boardRow(.finn, shows: ["255 pts"], "NATIVE-UI-PROGRESS-06")
        try boardRow(.cora, shows: ["50 pts"], "NATIVE-UI-PROGRESS-06")
        XCTAssertEqual(try [balance("finn"), balance("cora"), balance("sage")], ["255/2", "50/1", "0/0"], "[NATIVE-UI-PROGRESS-07] reaching the goal pays nobody")
        XCTAssertEqual(try control.rows("ledger").count, 4, "[NATIVE-UI-PROGRESS-07] only the picks are in the ledger")
        let goals = try control.rows("goals")
        XCTAssertEqual(goals.count, 1, "[NATIVE-UI-PROGRESS-08]")
        XCTAssertEqual(goals.first?["group"] as? String, "G1", "[NATIVE-UI-PROGRESS-08] the goal belongs to this group only")
    }
}
