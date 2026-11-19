import XCTest

/// Journey 7: each group has its own board, and a shared goal tracks group points only.
final class BoardJourneyTests: JourneyCase {
    private func row(_ actor: Actor) throws -> XCUIElement {
        try required("board.row." + accountID(actor), in: messages, timeout: 15, "NATIVE-UI-BOARD")
    }

    func testEachGroupHasItsOwnBoard() throws {
        try control.reset(points: ["G1": ["cora": 120, "finn": 210, "sage": 95], "G2": ["cora": 60, "finn": 35, "oli": 150]])
        try start(as: .cora)
        try tap("navigation.board", in: messages)
        let finn = try row(.finn), cora = try row(.cora), sage = try row(.sage)
        XCTAssertTrue(finn.label.contains("QA Finn") && finn.label.contains("210 pts"), "[NATIVE-UI-BOARD-01] \(finn.label)")
        XCTAssertTrue(cora.label.contains("120 pts"), "[NATIVE-UI-BOARD-01] \(cora.label)")
        XCTAssertTrue(sage.label.contains("95 pts"), "[NATIVE-UI-BOARD-01] \(sage.label)")
        XCTAssertTrue(finn.frame.minY < cora.frame.minY && cora.frame.minY < sage.frame.minY, "[NATIVE-UI-BOARD-02] ranked by points")
        XCTAssertFalse(element("board.row." + (try accountID(.oli)), in: messages).exists, "[NATIVE-UI-BOARD-03] nobody from another group")
        assertText("Points and streaks belong only to this group. There are no individual cash rewards.", in: messages, "NATIVE-UI-BOARD-04")

        try goHome()
        try tap("navigation.groups", in: messages)
        try tap("group.unlink", in: messages)
        try tap("group.link." + groupID("G2"), in: messages, timeout: 15)
        try tap("navigation.board", in: messages, timeout: 15)
        let oli = try row(.oli), coraThere = try row(.cora), finnThere = try row(.finn)
        XCTAssertTrue(oli.label.contains("150 pts"), "[NATIVE-UI-BOARD-05] \(oli.label)")
        XCTAssertTrue(coraThere.label.contains("60 pts"), "[NATIVE-UI-BOARD-05] the same person has separate points in each group: \(coraThere.label)")
        XCTAssertTrue(finnThere.label.contains("35 pts"), "[NATIVE-UI-BOARD-05] \(finnThere.label)")
        XCTAssertTrue(oli.frame.minY < coraThere.frame.minY && coraThere.frame.minY < finnThere.frame.minY, "[NATIVE-UI-BOARD-06]")
        XCTAssertFalse(element("board.row." + (try accountID(.sage)), in: messages).exists, "[NATIVE-UI-BOARD-07]")
    }

    func testAMemberProposesASharedGoalForThisGroupOnly() throws {
        try start(as: .cora, in: "G2")
        try tap("navigation.board", in: messages)
        assertText("No shared goal yet. A goal tracks group points only; it isn't a funded reward or a purchase obligation.", in: messages, "NATIVE-UI-GOAL-01", timeout: 15)
        try type("Synthetic picnic", into: "board.goalLabel")
        try type("300", into: "board.goalTarget")
        try tap(labelled("Propose shared goal", in: messages))
        assertText("Synthetic picnic", in: messages, "NATIVE-UI-GOAL-02", timeout: 15)
        let progress = messages.staticTexts.matching(NSPredicate(format: "label ENDSWITH %@", "/ 300 points · proposed")).firstMatch
        XCTAssertTrue(progress.waitForExistence(timeout: 10), "[NATIVE-UI-GOAL-03] the goal shows its target and that it is only proposed")
        let goals = try control.rows("goals")
        XCTAssertEqual(goals.count, 1, "[NATIVE-UI-GOAL-04] one goal")
        XCTAssertEqual(goals.first?["group"] as? String, "G2", "[NATIVE-UI-GOAL-04] in this group only")
        XCTAssertEqual(goals.first?["proposer"] as? String, "cora", "[NATIVE-UI-GOAL-04]")
        XCTAssertEqual(goals.first?["targetPoints"] as? Int, 300, "[NATIVE-UI-GOAL-04]")
        XCTAssertEqual(goals.first?["state"] as? String, "proposed", "[NATIVE-UI-GOAL-04]")
    }

    func testAnotherMemberConfirmsTheProposedGoal() throws {
        XCTAssertNil(try control.act("finn", "mutation", "v0Groups:proposeGoal", ["groupId": "@G1", "label": "Synthetic dinner", "targetPoints": 500, "requestId": "finn-goal"]))
        try start(as: .cora)
        try tap("navigation.board", in: messages)
        assertText("Synthetic dinner", in: messages, "NATIVE-UI-GOAL-05", timeout: 15)
        try tap(labelled("Confirm shared goal", in: messages))
        eventually("NATIVE-UI-GOAL-06") { (try self.control.rows("goals").first?["confirmedBy"] as? [String] ?? []).contains("cora") }
        XCTAssertEqual(try control.rows("goals").count, 1, "[NATIVE-UI-GOAL-06] confirming does not create another goal")
        XCTAssertEqual(try appCalls("v0Groups:confirmGoal"), 1, "[NATIVE-UI-GOAL-07]")
        XCTAssertEqual(try control.rows("ledger").count, 0, "[NATIVE-UI-GOAL-08] a goal moves nobody's points")
    }
}
