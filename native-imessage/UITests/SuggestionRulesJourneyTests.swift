import XCTest

/// Journey 6, the rules around suggestions: where an idea comes from and who it is about, editing one, the yes/no format
/// and typed context, a failed suggestion request, and the past bets and people the server never offers.
final class SuggestionRulesJourneyTests: JourneyCase {
    private let fromHistory = "From eligible group history"
    private let failure = "Couldn't complete this request. Check your connection and try again."

    private var ideas: XCUIElementQuery {
        messages.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "compose.suggestion."))
    }

    /// The suggestion with this question about this person; the app builds the identifier from both.
    private func idea(_ question: String, about actor: Actor) throws -> XCUIElement {
        element("compose.suggestion." + (try accountID(actor)) + ":" + question, in: messages)
    }

    /// A settled past bet in the fixture, stored without the creation checks so that a test can hold one the checks refuse.
    private func seedHistory(_ key: String, _ question: String, group: String = "G1", creator: String = "finn", subject: String = "sage", format: String = "yes_no", options: [String]? = nil, context: String? = nil) throws {
        var arguments: [String: Any] = ["key": key, "group": group, "creator": creator, "subject": subject, "question": question, "format": format]
        if let options { arguments["options"] = options }
        if let context { arguments["contextLine"] = context }
        try control.call("seedHistoryBet", arguments)
    }

    /// Cora holds today's turn about Sage and opens the new bet screen from it.
    private func openTurnCompose() throws {
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        try start(as: .cora)
        try tap("turn.create", in: messages)
        _ = try required("compose.question", in: messages, "NATIVE-UI-RULES-COMPOSE")
    }

    private func requireIdeas(_ code: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(ideas.firstMatch.waitForExistence(timeout: 20 * Self.pace), "[\(code)] suggestions are shown", file: file, line: line)
        XCTAssertTrue((3...5).contains(ideas.count), "[\(code)] three to five suggestions, found \(ideas.count)", file: file, line: line)
    }

    private func assertEveryIdeaIsAbout(_ actor: Actor, _ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let prefix = "compose.suggestion." + (try accountID(actor)) + ":"
        let shown = ideas.allElementsBoundByIndex.map { $0.identifier }
        XCTAssertTrue((3...5).contains(shown.count), "[\(code)] three to five suggestions, found \(shown.count)", file: file, line: line)
        XCTAssertTrue(shown.allSatisfy { $0.hasPrefix(prefix) }, "[\(code)] every suggestion is about \(actor.alias)", file: file, line: line)
    }

    /// None of these phrases is anywhere on the screen: not in a label, a value or an identifier.
    private func assertNotOnScreen(_ phrases: [String], _ code: String, file: StaticString = #filePath, line: UInt = #line) {
        for phrase in phrases {
            let found = messages.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@ OR value CONTAINS[c] %@ OR identifier CONTAINS[c] %@", phrase, phrase, phrase)).count
            XCTAssertEqual(found, 0, "[\(code)] \"\(phrase)\" must not be offered", file: file, line: line)
        }
    }

    private func assertHolds(_ id: String, _ value: String, _ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let field = try required(id, in: messages, code, file: file, line: line)
        let held = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [held], timeout: 10 * Self.pace), .completed, "[\(code)] \(id) holds \"\(value)\", found \"\(field.value as? String ?? "")\"", file: file, line: line)
    }

    private func requireDraftCard(_ code: String, file: StaticString = #filePath, line: UInt = #line) {
        let draft = messages.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Secret bet on QA Sage")).firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 20 * Self.pace), "[\(code)] the draft card is in the message field", file: file, line: line)
    }

    /// The one bet the app created in this test; settled fixture bets are left out.
    private func createdBet(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws -> [String: Any] {
        let open = try control.rows("bets").filter { $0["state"] as? String == "open" }
        XCTAssertEqual(open.count, 1, "[\(code)] exactly one bet is created", file: file, line: line)
        guard let bet = open.first else { throw Blocked() }
        return bet
    }

    /// The outcomes of the app's own suggestion requests, in order.
    private func suggestionRequests() throws -> [String] {
        try control.calls().filter { $0["path"] as? String == "v0Suggestions:get" }.compactMap { $0["outcome"] as? String }
    }

    /// Another fixture person asks the real public function for ideas. Returns the refusal code, or nil when ideas came back.
    private func ask(_ actor: String, group: String, about subject: String) throws -> String? {
        try control.act(actor, "action", "v0Suggestions:get", ["groupId": "@" + group, "subjectId": "@" + subject, "contextLine": "", "useHostedAi": false])
    }

    /// How often the extension itself, not the host app, got an answer from one public function.
    private func extensionAnswers(_ path: String) throws -> Int {
        try control.calls().filter { $0["path"] as? String == path && $0["caller"] as? String == "CalledItExtension" && $0["outcome"] as? String == "success" }.count
    }

    // MARK: J6.1

    func testATemplateIdeaBecomesADraftCardInThreeTaps() throws {
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        try start(as: .cora)
        // Every tap from the group's home to the draft card is counted here; scrolling is not a tap.
        var taps = 0
        try tap("turn.create", in: messages)
        taps += 1
        requireIdeas("NATIVE-UI-RULES-TAPS-01")
        try assertEveryIdeaIsAbout(.sage, "NATIVE-UI-RULES-TAPS-02")
        let first = ideas.firstMatch
        let chosen = first.label
        XCTAssertTrue(chosen.hasSuffix("Template"), "[NATIVE-UI-RULES-TAPS-03] with no past bets the first idea is named as a template: \(chosen)")
        try tap(first, scrolling: messages)
        taps += 1
        let question = try required("compose.question", in: messages, "NATIVE-UI-RULES-TAPS-04")
        let filled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let now = question.value as? String ?? ""
            return !now.isEmpty && now != question.placeholderValue && chosen.hasPrefix(now)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [filled], timeout: 10 * Self.pace), .completed, "[NATIVE-UI-RULES-TAPS-04] the chosen idea fills the question")
        let text = question.value as? String ?? ""
        try tap("compose.create", in: messages)
        taps += 1
        requireDraftCard("NATIVE-UI-RULES-TAPS-05")
        XCTAssertEqual(taps, 3, "[NATIVE-UI-RULES-TAPS-06] from the group's home to a draft card took \(taps) taps; sending it in Messages is one more")
        let bet = try createdBet("NATIVE-UI-RULES-TAPS-07")
        XCTAssertEqual(bet["question"] as? String, text, "[NATIVE-UI-RULES-TAPS-07] the bet carries the idea that was shown")
        XCTAssertEqual(bet["source"] as? String, "template", "[NATIVE-UI-RULES-TAPS-08] an unedited template idea is recorded as a template")
        XCTAssertEqual(bet["subject"] as? String, "sage", "[NATIVE-UI-RULES-TAPS-08]")
        XCTAssertEqual(bet["creator"] as? String, "cora", "[NATIVE-UI-RULES-TAPS-08]")
        XCTAssertEqual(try appCalls("v0Bets:create"), 1, "[NATIVE-UI-RULES-TAPS-09]")
    }

    func testAPastBetIsOfferedOnlyForItsOwnSubjectAndGroup() throws {
        let kite = "Will they bring a kite?"
        let bread = "Will they bake bread?"
        let plants = "Will they water the plants?"
        try seedHistory("history-kite", kite, creator: "finn", subject: "sage")
        try seedHistory("history-bread", bread, creator: "sage", subject: "finn")
        // The same subject and a creator Cora shares a group with, but in the other group.
        try seedHistory("history-plants", plants, group: "G2", creator: "oli", subject: "finn")
        try openTurnCompose()

        let aboutSage = try idea(kite, about: .sage)
        XCTAssertTrue(aboutSage.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-RULES-SOURCE-01] the group's settled bet about Sage is offered")
        XCTAssertTrue(aboutSage.label.hasPrefix(kite) && aboutSage.label.hasSuffix(fromHistory), "[NATIVE-UI-RULES-SOURCE-02] it is named as group history: \(aboutSage.label)")
        try assertEveryIdeaIsAbout(.sage, "NATIVE-UI-RULES-SOURCE-03")
        let labels = ideas.allElementsBoundByIndex.map { $0.label }
        XCTAssertEqual(labels.filter { $0.hasSuffix(fromHistory) }.count, 1, "[NATIVE-UI-RULES-SOURCE-04] one idea comes from history")
        XCTAssertEqual(labels.filter { $0.hasSuffix("Template") }.count, labels.count - 1, "[NATIVE-UI-RULES-SOURCE-04] every other idea is named as a template")
        assertNotOnScreen([bread, plants], "NATIVE-UI-RULES-SCOPE-01")

        // Another subject: Sage's idea goes, Finn's own past bet from this group comes, the other group's stays out.
        try chooseMenu("compose.subject", "QA Finn")
        let aboutFinn = try idea(bread, about: .finn)
        XCTAssertTrue(aboutFinn.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-RULES-STALE-01] the new subject's own past bet is offered")
        assertGone(aboutSage, "NATIVE-UI-RULES-STALE-02")
        try assertEveryIdeaIsAbout(.finn, "NATIVE-UI-RULES-STALE-03")
        XCTAssertTrue(aboutFinn.label.hasSuffix(fromHistory), "[NATIVE-UI-RULES-STALE-04] \(aboutFinn.label)")
        assertNotOnScreen([kite], "NATIVE-UI-RULES-STALE-05")
        assertNotOnScreen([plants], "NATIVE-UI-RULES-SCOPE-02")
        XCTAssertEqual(try suggestionRequests(), ["success", "success"], "[NATIVE-UI-RULES-STALE-06] the ideas were asked for again for the new subject")

        // And back: nothing of Finn's is left, and the history idea can be used as it is.
        try chooseMenu("compose.subject", "QA Sage")
        XCTAssertTrue(aboutSage.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-RULES-STALE-07]")
        assertGone(aboutFinn, "NATIVE-UI-RULES-STALE-08")
        try assertEveryIdeaIsAbout(.sage, "NATIVE-UI-RULES-STALE-09")
        try tap(aboutSage, scrolling: messages)
        try assertHolds("compose.question", kite, "NATIVE-UI-RULES-SOURCE-05")
        try tap("compose.create", in: messages)
        requireDraftCard("NATIVE-UI-RULES-SOURCE-06")
        let bet = try createdBet("NATIVE-UI-RULES-SOURCE-07")
        XCTAssertEqual(bet["question"] as? String, kite, "[NATIVE-UI-RULES-SOURCE-07]")
        XCTAssertEqual(bet["source"] as? String, "history", "[NATIVE-UI-RULES-SOURCE-08] an unedited history idea is recorded as history")
        XCTAssertEqual(bet["subject"] as? String, "sage", "[NATIVE-UI-RULES-SOURCE-08]")
        XCTAssertEqual(bet["group"] as? String, "G1", "[NATIVE-UI-RULES-SOURCE-08]")
    }

    func testAChosenIdeaFillsTheFormAndCanBeEditedBeforeItIsCreated() throws {
        let past = "Which will they bring?"
        let edited = "Which will they carry?"
        try seedHistory("history-bring", past, format: "this_that", options: ["A kite", "A ball"])
        try openTurnCompose()
        let chosen = try idea(past, about: .sage)
        XCTAssertTrue(chosen.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-RULES-EDIT-01] the past this/that bet is offered")
        XCTAssertFalse(element("compose.optionA", in: messages).exists, "[NATIVE-UI-RULES-EDIT-02] the form starts as yes/no")
        try tap(chosen, scrolling: messages)
        // The idea fills fields the person can change: the question and both choices, in the idea's own format.
        try assertHolds("compose.question", past, "NATIVE-UI-RULES-EDIT-03")
        try assertHolds("compose.optionA", "A kite", "NATIVE-UI-RULES-EDIT-03")
        try assertHolds("compose.optionB", "A ball", "NATIVE-UI-RULES-EDIT-03")

        let question = try required("compose.question", in: messages, "NATIVE-UI-RULES-EDIT-04")
        try tap(question, scrolling: messages)
        let focused = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (question.value(forKey: "hasKeyboardFocus") as? Bool) ?? false }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [focused], timeout: 15 * Self.pace), .completed, "[NATIVE-UI-RULES-EDIT-04] the filled question takes the keyboard")
        clear(question)
        try enter(edited, into: question, called: "compose.question")
        try tap("compose.create", in: messages)
        requireDraftCard("NATIVE-UI-RULES-EDIT-05")
        let bet = try createdBet("NATIVE-UI-RULES-EDIT-06")
        XCTAssertEqual(bet["question"] as? String, edited, "[NATIVE-UI-RULES-EDIT-06] the bet carries the edited question")
        XCTAssertEqual(bet["format"] as? String, "this_that", "[NATIVE-UI-RULES-EDIT-07] the format came from the idea")
        XCTAssertEqual(bet["options"] as? [String], ["A kite", "A ball"], "[NATIVE-UI-RULES-EDIT-07] the choices came from the idea")
        XCTAssertEqual(bet["source"] as? String, "manual", "[NATIVE-UI-RULES-EDIT-08] an edited idea is no longer recorded as history")
        XCTAssertEqual(bet["subject"] as? String, "sage", "[NATIVE-UI-RULES-EDIT-08]")
    }

    func testAYesNoBetKeepsItsTypedContextOffTheCardAndAwayFromTheGroup() throws {
        let context = "Synthetic kite afternoon"
        let question = "Will the fixture fly a kite"
        try openTurnCompose()
        XCTAssertFalse(element("compose.line", in: messages).exists, "[NATIVE-UI-RULES-YESNO-01] yes/no asks for no line")
        XCTAssertFalse(element("compose.optionA", in: messages).exists, "[NATIVE-UI-RULES-YESNO-01] yes/no asks for no choices")
        try type(context, into: "compose.context")
        try type(question, into: "compose.question")
        try tap("compose.create", in: messages)
        requireDraftCard("NATIVE-UI-RULES-YESNO-02")
        let bet = try createdBet("NATIVE-UI-RULES-YESNO-03")
        XCTAssertEqual(bet["format"] as? String, "yes_no", "[NATIVE-UI-RULES-YESNO-03]")
        XCTAssertEqual(bet["options"] as? [String], ["Yes", "No"], "[NATIVE-UI-RULES-YESNO-03] the two choices are Yes and No")
        XCTAssertEqual(bet["question"] as? String, question, "[NATIVE-UI-RULES-YESNO-03]")
        XCTAssertEqual(bet["source"] as? String, "manual", "[NATIVE-UI-RULES-YESNO-03]")

        // The context reached the server with the bet, and is nowhere in Messages: not on the draft card, not on screen.
        let id = bet["id"] as? String ?? ""
        XCTAssertEqual(try control.rows("betContexts").first { $0["id"] as? String == id }?["contextLine"] as? String, context, "[NATIVE-UI-RULES-CONTEXT-01] the typed context is saved with the bet")
        assertNoPrivateText(in: messages, extra: [context, question], "NATIVE-UI-RULES-CONTEXT-02")
        // What the server gives the other members' apps for this group's bets, card included.
        for (member, seesQuestion) in [("finn", true), ("sage", false)] {
            let reply = try control.call("act", ["actor": member, "kind": "query", "path": "v0Bets:list", "args": ["groupId": "@G1"]]) as? [String: Any]
            XCTAssertEqual(reply?["ok"] as? Bool, true, "[NATIVE-UI-RULES-CONTEXT-03] \(member) can list the group's bets")
            guard let value = reply?["value"], JSONSerialization.isValidJSONObject(value), let listed = String(data: try JSONSerialization.data(withJSONObject: value), encoding: .utf8) else {
                XCTFail("[NATIVE-UI-RULES-CONTEXT-03] unreadable list for \(member)")
                throw Blocked()
            }
            XCTAssertTrue(listed.contains("Secret bet on QA Sage"), "[NATIVE-UI-RULES-CONTEXT-03] \(member) is given the card")
            XCTAssertEqual(listed.contains(question), seesQuestion, "[NATIVE-UI-RULES-CONTEXT-04] only a bettor is given the question before the reveal: \(member)")
            XCTAssertFalse(listed.contains(context), "[NATIVE-UI-RULES-CONTEXT-05] \(member) is never given the creator's typed context")
        }
    }

    // MARK: J6.2

    func testAFailedSuggestionRequestLeavesTheScreenUsableAndAskingAgainBringsSafeIdeas() throws {
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        try start(as: .cora)
        try control.failNext("v0Suggestions:get", count: 1)
        try tap("turn.create", in: messages)
        _ = try required("compose.question", in: messages, "NATIVE-UI-RULES-FALLBACK-01")
        assertText(failure, in: messages, "NATIVE-UI-RULES-FALLBACK-02")
        XCTAssertEqual(ideas.count, 0, "[NATIVE-UI-RULES-FALLBACK-03] no idea is shown from a failed request")
        XCTAssertEqual(try suggestionRequests(), ["injected"], "[NATIVE-UI-RULES-FALLBACK-04] the request failed once and was not repeated behind the person's back")
        let again = try required("compose.suggestions", in: messages, "NATIVE-UI-RULES-FALLBACK-05")
        assertLabel(again, "Get suggestions", "NATIVE-UI-RULES-FALLBACK-05")

        try tap(again, scrolling: messages)
        requireIdeas("NATIVE-UI-RULES-FALLBACK-06")
        let labels = ideas.allElementsBoundByIndex.map { $0.label }
        XCTAssertTrue(labels.allSatisfy { $0.hasSuffix("Template") }, "[NATIVE-UI-RULES-FALLBACK-07] the ideas are the built-in templates: \(labels)")
        assertGone(text(failure, in: messages), "NATIVE-UI-RULES-FALLBACK-08")
        XCTAssertEqual(try suggestionRequests(), ["injected", "success"], "[NATIVE-UI-RULES-FALLBACK-09]")

        try tap(ideas.firstMatch, scrolling: messages)
        try tap("compose.create", in: messages)
        requireDraftCard("NATIVE-UI-RULES-FALLBACK-10")
        let bet = try createdBet("NATIVE-UI-RULES-FALLBACK-11")
        XCTAssertEqual(bet["source"] as? String, "template", "[NATIVE-UI-RULES-FALLBACK-11]")
        XCTAssertEqual(bet["subject"] as? String, "sage", "[NATIVE-UI-RULES-FALLBACK-11]")
    }

    // MARK: J6.3

    func testUnsafeAndMalformedPastBetsAreNeverOfferedAsIdeas() throws {
        let safe = "Will they bring a kite?"
        // The safe bet is the oldest. The server reads past bets newest first, so it is reached only after every other one
        // was looked at and left out.
        try seedHistory("history-safe", safe)
        let unsafe = [
            ("history-health", "Will they take their medication before the reveal?"),
            ("history-money", "Will they pay their rent late this month?"),
            ("history-relationship", "Will they text their ex before the reveal?"),
            ("history-appearance", "Will they look prettier than last week?"),
        ]
        for (key, question) in unsafe { try seedHistory(key, question) }
        let soup = "Will they order the soup before the reveal?"
        try seedHistory("history-context", soup, context: "Right after their therapy session.")
        let juggle = "Will they juggle before the reveal?"
        let whistle = "Will they whistle before the reveal?"
        try seedHistory("history-same-choices", juggle, options: ["Yes", " yes "])
        try seedHistory("history-blank-choice", whistle, options: [" ", "No"])
        try seedHistory("history-no-words", "???")
        try openTurnCompose()

        let offered = try idea(safe, about: .sage)
        XCTAssertTrue(offered.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-RULES-FILTER-01] the safe settled bet is offered, so past bets are being read")
        XCTAssertTrue(offered.label.hasSuffix(fromHistory), "[NATIVE-UI-RULES-FILTER-01] \(offered.label)")
        try assertEveryIdeaIsAbout(.sage, "NATIVE-UI-RULES-FILTER-02")
        let labels = ideas.allElementsBoundByIndex.map { $0.label }
        XCTAssertEqual(labels.filter { $0.hasSuffix(fromHistory) }.count, 1, "[NATIVE-UI-RULES-FILTER-03] no other past bet is offered: \(labels)")
        XCTAssertEqual(labels.filter { $0.hasSuffix("Template") }.count, labels.count - 1, "[NATIVE-UI-RULES-FILTER-03] the rest are templates: \(labels)")
        assertNotOnScreen(unsafe.map { $0.1 } + [soup, "therapy"], "NATIVE-UI-RULES-FILTER-04")
        assertNotOnScreen([juggle, whistle], "NATIVE-UI-RULES-MALFORMED-01")
        XCTAssertFalse(try idea("???", about: .sage).exists, "[NATIVE-UI-RULES-MALFORMED-02] a past bet whose question has no words is not offered")
        XCTAssertEqual(try suggestionRequests(), ["success"], "[NATIVE-UI-RULES-FILTER-05] the request itself succeeded")
    }

    func testOnlyOtherMembersOfThisGroupCanBeChosenAndNobodyIsOfferedIdeasAboutThemselves() throws {
        // Sage is the subject of today's turn, which Cora holds.
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        try start(as: .sage)
        eventually("NATIVE-UI-RULES-SELF-01") { try self.extensionAnswers("v0Groups:turn") >= 1 }
        XCTAssertFalse(element("turn.create", in: messages).exists, "[NATIVE-UI-RULES-SELF-01] the subject is not offered today's bet")
        try tap("navigation.newBet", in: messages)
        _ = try required("compose.question", in: messages, "NATIVE-UI-RULES-SELF-02")
        eventually("NATIVE-UI-RULES-SELF-02") { try self.extensionAnswers("v0Groups:members") >= 1 }

        try tap("compose.subject", in: messages)
        let finn = try labelled("QA Finn", in: messages)
        _ = try labelled("QA Cora", in: messages)
        XCTAssertFalse(labelled("QA Sage", in: messages, timeout: 2, quiet: true), "[NATIVE-UI-RULES-SELF-03] a person cannot choose themselves")
        XCTAssertFalse(labelled("QA Oli", in: messages, timeout: 2, quiet: true), "[NATIVE-UI-RULES-MEMBER-01] someone outside this group cannot be chosen")
        XCTAssertEqual(try suggestionRequests(), [], "[NATIVE-UI-RULES-SELF-04] no ideas are asked for before a friend is chosen")
        try tap(finn)
        requireIdeas("NATIVE-UI-RULES-SELF-05")
        try assertEveryIdeaIsAbout(.finn, "NATIVE-UI-RULES-SELF-06")
        assertNotOnScreen(["compose.suggestion." + (try accountID(.sage)), "compose.suggestion." + (try accountID(.oli))], "NATIVE-UI-RULES-SELF-07")
        XCTAssertEqual(try suggestionRequests(), ["success"], "[NATIVE-UI-RULES-SELF-08]")

        // The server's own answers, through the real public function with each person's own sign-in.
        XCTAssertEqual(try ask("sage", group: "G1", about: "sage"), "NOT_AVAILABLE", "[NATIVE-UI-RULES-SELF-09] the server gives nobody ideas about themselves")
        XCTAssertEqual(try ask("cora", group: "G1", about: "oli"), "NOT_AVAILABLE", "[NATIVE-UI-RULES-MEMBER-02] no ideas about someone who is not in the group")
        XCTAssertEqual(try ask("oli", group: "G1", about: "sage"), "NOT_AVAILABLE", "[NATIVE-UI-RULES-MEMBER-03] no ideas for someone who is not in the group")
        XCTAssertNil(try ask("cora", group: "G1", about: "sage"), "[NATIVE-UI-RULES-MEMBER-04] a member asking about another member is answered")
    }
}
