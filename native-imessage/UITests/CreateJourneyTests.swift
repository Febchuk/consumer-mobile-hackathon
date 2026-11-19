import XCTest

/// Journey 6: the creator gets safe suggestions, can edit them, and the server refuses what the subject blocked.
final class CreateJourneyTests: JourneyCase {
    private func openNewBet() throws {
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        try start(as: .cora)
        try tap("turn.create", in: messages)
        _ = try required("compose.question", in: messages, "NATIVE-UI-COMPOSE")
    }

    private func requireDraftCard(_ code: String) {
        let draft = messages.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Secret bet on QA Sage")).firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 20 * Self.pace), "[\(code)] the draft card is in the message field")
    }

    func testSafeSuggestionsAppearAndOneCanBeUsed() throws {
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        try start(as: .cora)
        let create = try required("turn.create", in: messages)
        // The clock starts before the tap that opens the screen, so loading that begins with it is counted.
        let opened = ProcessInfo.processInfo.systemUptime
        try tap(create, scrolling: messages)
        let ideas = messages.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "compose.suggestion."))
        XCTAssertTrue(ideas.firstMatch.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-IDEAS-01] suggestions appear without asking")
        try budget("NATIVE-UI-IDEAS-02", "safe suggestions shown after the new bet screen opens", seconds: ProcessInfo.processInfo.systemUptime - opened, limit: 3)
        XCTAssertTrue((3...5).contains(ideas.count), "[NATIVE-UI-IDEAS-03] three to five suggestions, found \(ideas.count)")
        for index in 0..<ideas.count {
            let label = ideas.element(boundBy: index).label
            XCTAssertTrue(label.hasSuffix("Template") || label.hasSuffix("From eligible group history"), "[NATIVE-UI-IDEAS-04] every suggestion names where it came from: \(label)")
        }
        assertText("Only templates, eligible past group bets and the context you type are used. Called It reads no chats, contacts or photos. Context is saved with your bet and is removed by data deletion.", in: messages, "NATIVE-UI-IDEAS-05")
        XCTAssertEqual(try appCalls("v0Suggestions:get"), 1, "[NATIVE-UI-IDEAS-06]")

        let chosen = ideas.firstMatch.label
        try tap(ideas.firstMatch, scrolling: messages)
        let question = try required("compose.question", in: messages)
        let filled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let now = question.value as? String ?? ""
            return !now.isEmpty && now != question.placeholderValue && chosen.hasPrefix(now)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [filled], timeout: 10 * Self.pace), .completed, "[NATIVE-UI-IDEAS-07] the chosen suggestion fills the question, where it can be edited")
        let text = question.value as? String ?? ""
        try tap("compose.create", in: messages)
        requireDraftCard("NATIVE-UI-IDEAS-08")
        let bets = try control.rows("bets")
        XCTAssertEqual(bets.count, 1, "[NATIVE-UI-IDEAS-09]")
        XCTAssertEqual(bets.first?["question"] as? String, text, "[NATIVE-UI-IDEAS-09] the bet carries the suggestion that was shown")
        XCTAssertEqual(bets.first?["subject"] as? String, "sage", "[NATIVE-UI-IDEAS-09]")
    }

    func testCreateIsReachableAboveTheKeyboardFromTheQuestionAndContextFields() throws {
        try openNewBet()
        let action = element("keyboard.action", in: messages)
        let done = element("keyboard.done", in: messages)
        func offered(enabled: Bool, _ code: String) {
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                action.exists && action.isHittable && action.isEnabled == enabled && done.exists && done.isHittable
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 15 * Self.pace), .completed, "[\(code)] Create card sits beside Done on top of the keyboard, enabled: \(enabled)")
        }
        // In the context field, with no question yet, the action is there and cannot be used.
        try type("Synthetic context", into: "compose.context")
        offered(enabled: false, "NATIVE-UI-KEYBOARD-01")
        XCTAssertEqual(action.label, "Create card", "[NATIVE-UI-KEYBOARD-01] the action has a readable name")
        // In the question field, once the bet is complete, it can be tapped without putting the keyboard away.
        try type("Will the fixture finish on time", into: "compose.question")
        offered(enabled: true, "NATIVE-UI-KEYBOARD-02")
        action.tap()
        requireDraftCard("NATIVE-UI-KEYBOARD-03")
        let bets = try control.rows("bets")
        XCTAssertEqual(bets.count, 1, "[NATIVE-UI-KEYBOARD-03] exactly one bet is created")
        XCTAssertEqual(bets.first?["question"] as? String, "Will the fixture finish on time", "[NATIVE-UI-KEYBOARD-03]")
        XCTAssertFalse(done.exists, "[NATIVE-UI-KEYBOARD-04] the keyboard is put away when the card is created")
    }

    func testAnOverUnderBetIsCreatedWithItsLine() throws {
        try openNewBet()
        try chooseMenu("compose.format", "Over / Under")
        try type("How many songs will the fixture play", into: "compose.question")
        try type("2.5", into: "compose.line")
        try tap("compose.create", in: messages)
        requireDraftCard("NATIVE-UI-FORMAT-06")
        let bet = try control.rows("bets").first
        XCTAssertEqual(bet?["format"] as? String, "over_under", "[NATIVE-UI-FORMAT-06]")
        XCTAssertEqual(bet?["options"] as? [String], ["Over 2.5", "Under 2.5"], "[NATIVE-UI-FORMAT-06] the two choices come from the line")
    }

    func testAThisThatBetIsCreatedWithItsTwoChoices() throws {
        try openNewBet()
        try chooseMenu("compose.format", "This / That")
        try type("Which will the fixture pick", into: "compose.question")
        try type("Tea", into: "compose.optionA")
        try type("Coffee", into: "compose.optionB")
        try tap("compose.create", in: messages)
        requireDraftCard("NATIVE-UI-FORMAT-07")
        let bet = try control.rows("bets").first
        XCTAssertEqual(bet?["format"] as? String, "this_that", "[NATIVE-UI-FORMAT-07]")
        XCTAssertEqual(bet?["options"] as? [String], ["Tea", "Coffee"], "[NATIVE-UI-FORMAT-07]")
        assertNoPrivateText(in: messages, extra: ["Tea", "Coffee", "Which will the fixture pick"], "NATIVE-UI-FORMAT-08")
    }

    func testAQuestionOnATopicTheSubjectBlockedIsRefused() throws {
        XCTAssertNil(try control.act("sage", "mutation", "v0Controls:update", ["noBets": false, "blockedTopics": ["karaoke"], "hostedAiConsent": false, "requestId": "sage-topics"]))
        try openNewBet()
        try type("Will the fixture sing karaoke tonight", into: "compose.question")
        try tap("compose.create", in: messages)
        let refusal = text("Check your entries and try again.", in: messages)
        XCTAssertTrue(refusal.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-TOPIC-01] the person is told the bet was not accepted")
        XCTAssertEqual(try control.rows("bets").count, 0, "[NATIVE-UI-TOPIC-02] no bet is created")
        XCTAssertEqual(try appCalls("v0Bets:create", outcome: "INVALID_INPUT"), 1, "[NATIVE-UI-TOPIC-03] the server refused it")
        XCTAssertEqual(messages.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "blocked")).count, 0, "[NATIVE-UI-TOPIC-04] the refusal does not say the subject blocked a topic")
        _ = try required("compose.question", in: messages, "NATIVE-UI-TOPIC-05")
    }
}
