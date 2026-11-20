import XCTest

/// Journey 3.1, the noon pass: a creator who has not sent a bet by 12:00 noon group time loses the turn, once, to the
/// next member. The server clock cannot move, so the fixture moves the group and its unused turn to an hour past the
/// group's noon (see shiftTurnPastNoon in the overlay); the pass itself is done by the product's own turns job. The
/// home screen reads the turn when it opens, so each check of the screen opens the home again.
final class TurnRulesJourneyTests: JourneyCase {
    /// Today's turn in G1 as the server holds it.
    private func turns(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws -> [String: Any] {
        let rows = try control.rows("turns").filter { $0["group"] as? String == "G1" }
        XCTAssertEqual(rows.count, 1, "[\(code)] the server holds one turn for the group's day", file: file, line: line)
        guard let turn = rows.first else { throw Blocked() }
        return turn
    }

    /// Moves G1 and its unused turn past the group's noon. Nothing is passed by this.
    private func moveGroupPastNoon(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let moved = try control.call("turnPastNoon", ["group": "G1"]) as? [String: Any]
        let minutes = moved?["minutesPastNoon"] as? Int ?? -1
        XCTAssertTrue((60..<120).contains(minutes), "[\(code)] fixture: it is between 13:00 and 14:00 in the group's zone, found \(minutes) minutes past noon", file: file, line: line)
        let turn = try turns(code, file: file, line: line)
        XCTAssertEqual(turn["status"] as? String, "assigned", "[\(code)] fixture: moving the day passes nothing", file: file, line: line)
        XCTAssertEqual(turn["creator"] as? String, "cora", "[\(code)] fixture: moving the day passes nothing", file: file, line: line)
        XCTAssertEqual(turn["passed"] as? Bool, false, "[\(code)] fixture: moving the day passes nothing", file: file, line: line)
    }

    /// Runs the product's turns job once and returns how many turns it passed.
    private func passedByTheTurnsJob(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws -> Int {
        guard let counts = try control.call("runJob", ["job": "turns"]) as? [String: Any], let passed = counts["passed"] as? Int else {
            XCTFail("[\(code)] the turns job returned no counts", file: file, line: line)
            throw Blocked()
        }
        return passed
    }

    /// Leaves the group's home and opens it again, which reads the turn from the server.
    private func openHomeAgain() throws {
        try tap("navigation.board", in: messages)
        try goHome()
    }

    func testAnUnusedTurnPassesOnceAtNoonAndTheFirstCreatorIsNoLongerOfferedIt() throws {
        // G1 in join order is Cora, Sage, Finn.
        try control.seedTurn(group: "G1", creator: "cora", subject: "finn")
        try start(as: .cora)
        assertText("Your creator turn", in: messages, "NATIVE-UI-NOON-01")
        _ = try required("turn.create", in: messages, "NATIVE-UI-NOON-01")

        // Noon has gone by and the job has not run yet: the turn is still Cora's.
        try moveGroupPastNoon("NATIVE-UI-NOON-02")
        try openHomeAgain()
        assertText("Your creator turn", in: messages, "NATIVE-UI-NOON-03")
        _ = try required("turn.create", in: messages, "NATIVE-UI-NOON-03")

        XCTAssertEqual(try passedByTheTurnsJob("NATIVE-UI-NOON-04"), 1, "[NATIVE-UI-NOON-04] the turns job passes the unused turn after noon")
        let passed = try turns("NATIVE-UI-NOON-05")
        XCTAssertEqual(passed["status"] as? String, "passed", "[NATIVE-UI-NOON-05]")
        XCTAssertEqual(passed["creator"] as? String, "sage", "[NATIVE-UI-NOON-05] the turn goes to the next member in join order")
        XCTAssertEqual(passed["subject"] as? String, "finn", "[NATIVE-UI-NOON-05] the subject stays the same when the new creator can make a bet about them")
        XCTAssertEqual(passed["passed"] as? Bool, true, "[NATIVE-UI-NOON-05]")
        XCTAssertEqual(passed["hasBet"] as? Bool, false, "[NATIVE-UI-NOON-05]")
        let queued = try control.rows("outbox").filter { $0["group"] as? String == "G1" && $0["kind"] as? String == "turn" }
        XCTAssertEqual(queued.map { $0["actor"] as? String }, ["sage"], "[NATIVE-UI-NOON-05] the turn notification is queued for the new creator only")

        try openHomeAgain()
        assertText("Today's creator turn", in: messages, "NATIVE-UI-NOON-06")
        XCTAssertFalse(text("Your creator turn", in: messages).exists, "[NATIVE-UI-NOON-06] the first creator is no longer told the turn is hers")
        XCTAssertFalse(element("turn.create", in: messages).exists, "[NATIVE-UI-NOON-06] the first creator is no longer offered today's bet")
        XCTAssertFalse(element("turn.pass", in: messages).exists, "[NATIVE-UI-NOON-06] she has nothing left to pass")

        // The job again, and a pass by hand from the member who now holds the turn: nothing moves a second time.
        XCTAssertEqual(try passedByTheTurnsJob("NATIVE-UI-NOON-07"), 0, "[NATIVE-UI-NOON-07] a second run passes nothing")
        XCTAssertEqual(try control.act("sage", "mutation", "v0Groups:passTurn", ["groupId": "@G1", "requestId": "sage-pass-again"]), "NOT_AVAILABLE", "[NATIVE-UI-NOON-08] the member the turn passed to cannot pass it on")
        XCTAssertEqual(try control.act("cora", "mutation", "v0Groups:passTurn", ["groupId": "@G1", "requestId": "cora-pass-late"]), "NOT_AVAILABLE", "[NATIVE-UI-NOON-08] the first creator cannot pass a turn she no longer holds")
        let after = try turns("NATIVE-UI-NOON-09")
        XCTAssertEqual(after["creator"] as? String, "sage", "[NATIVE-UI-NOON-09] the turn passed exactly once")
        XCTAssertEqual(after["subject"] as? String, "finn", "[NATIVE-UI-NOON-09]")
        XCTAssertEqual(after["status"] as? String, "passed", "[NATIVE-UI-NOON-09]")
        try openHomeAgain()
        assertText("Today's creator turn", in: messages, "NATIVE-UI-NOON-10")
        XCTAssertFalse(element("turn.create", in: messages).exists, "[NATIVE-UI-NOON-10]")
        XCTAssertEqual(try control.rows("bets").count, 0, "[NATIVE-UI-NOON-10] no bet was made by any of this")
    }

    func testTheMemberTheTurnPassedToAtNoonMakesTheDaysOneBet() throws {
        try control.seedTurn(group: "G1", creator: "cora", subject: "finn")
        try start(as: .sage)
        assertText("Today's creator turn", in: messages, "NATIVE-UI-NOON-11")
        XCTAssertFalse(element("turn.create", in: messages).exists, "[NATIVE-UI-NOON-11] before noon the next member is not offered the turn")

        try moveGroupPastNoon("NATIVE-UI-NOON-12")
        XCTAssertEqual(try passedByTheTurnsJob("NATIVE-UI-NOON-13"), 1, "[NATIVE-UI-NOON-13] the turns job passes the unused turn after noon")
        try openHomeAgain()
        assertText("Your creator turn", in: messages, "NATIVE-UI-NOON-14")
        XCTAssertFalse(text("Today's creator turn", in: messages).exists, "[NATIVE-UI-NOON-14]")
        XCTAssertFalse(element("turn.pass", in: messages).exists, "[NATIVE-UI-NOON-14] a turn that was passed is not offered for passing again")

        // The first creator can no longer make today's bet.
        XCTAssertEqual(try control.act("cora", "mutation", "v0Bets:create", ["groupId": "@G1", "subjectId": "@finn", "question": "Will the late fixture finish first?", "contextLine": "", "format": "yes_no", "options": ["Yes", "No"], "source": "manual", "requestId": "cora-late-create"]), "FORBIDDEN", "[NATIVE-UI-NOON-15] the first creator's bet is refused after the pass")

        try tap("turn.create", in: messages)
        _ = try required("compose.subject", in: messages, "NATIVE-UI-NOON-15")
        let question = "Will the noon fixture finish first " + run.manifest.runID.prefix(8)
        try type(question, into: "compose.question")
        XCTAssertEqual(try control.rows("bets").count, 0, "[NATIVE-UI-NOON-15] nothing exists before Create card")
        try tap("compose.create", in: messages)
        let draft = messages.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Secret bet on QA Finn")).firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-NOON-16] the draft card names the subject the turn kept")
        let bets = try control.rows("bets")
        XCTAssertEqual(bets.count, 1, "[NATIVE-UI-NOON-17] exactly one bet")
        XCTAssertEqual(bets.first?["creator"] as? String, "sage", "[NATIVE-UI-NOON-17] made by the member the turn passed to")
        XCTAssertEqual(bets.first?["subject"] as? String, "finn", "[NATIVE-UI-NOON-17]")
        XCTAssertEqual(bets.first?["group"] as? String, "G1", "[NATIVE-UI-NOON-17]")
        XCTAssertEqual(try appCalls("v0Bets:create"), 1, "[NATIVE-UI-NOON-17] one create request")
        let used = try turns("NATIVE-UI-NOON-18")
        XCTAssertEqual(used["status"] as? String, "created", "[NATIVE-UI-NOON-18] the day's turn is used by this bet")
        XCTAssertEqual(used["hasBet"] as? Bool, true, "[NATIVE-UI-NOON-18]")
        XCTAssertEqual(used["creator"] as? String, "sage", "[NATIVE-UI-NOON-18]")

        // Another run of the job changes nothing.
        XCTAssertEqual(try passedByTheTurnsJob("NATIVE-UI-NOON-20"), 0, "[NATIVE-UI-NOON-20]")
        XCTAssertEqual(try control.rows("bets").count, 1, "[NATIVE-UI-NOON-20] still one bet for the day")
        XCTAssertEqual(try turns("NATIVE-UI-NOON-20")["status"] as? String, "created", "[NATIVE-UI-NOON-20]")
    }
}
