import XCTest

/// Journey 1: a conversation is tied to a group only by an explicit choice, and the creator makes the first bet.
final class StartJourneyTests: JourneyCase {
    private var groupName: String { "QA G1 " + run.manifest.runID.prefix(8) }

    func testAnUnknownConversationAsksForAnExplicitLink() throws {
        try signIn(.cora)
        try openExtension()
        _ = try labelled("Link this conversation", in: messages, timeout: 20)
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-START-01] no group is assumed for an unknown conversation")
        XCTAssertFalse(text(groupName, in: messages).exists, "[NATIVE-UI-START-01]")
        XCTAssertEqual(try appLinks().count, 0, "[NATIVE-UI-START-01] nothing is linked before the person chooses")

        try tap(labelled("Link this conversation", in: messages))
        _ = try required("group.link." + groupID("G1"), in: messages, "NATIVE-UI-START-02")
        _ = try required("group.link." + groupID("G2"), in: messages, "NATIVE-UI-START-02")
        try tap("group.link." + groupID("G1"), in: messages)
        _ = try required("navigation.board", in: messages, timeout: 15, "NATIVE-UI-START-03")
        assertText(groupName, in: messages, "NATIVE-UI-START-03")
        let links = try appLinks()
        XCTAssertEqual(links.count, 1, "[NATIVE-UI-START-04] exactly one link")
        XCTAssertEqual(links.first?["actor"] as? String, "cora", "[NATIVE-UI-START-04]")
        XCTAssertEqual(links.first?["group"] as? String, "G1", "[NATIVE-UI-START-04]")

        // A different conversation on the same phone starts unlinked: the last group is never carried over.
        try openExtension(conversation: 1)
        _ = try labelled("Link this conversation", in: messages, timeout: 20)
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-START-05] another conversation does not inherit the last group")
        XCTAssertFalse(text(groupName, in: messages).exists, "[NATIVE-UI-START-05]")
        XCTAssertEqual(try appLinks().count, 1, "[NATIVE-UI-START-05] opening another conversation links nothing")
    }

    func testTheCreatorMakesExactlyOneBetAboutTheAssignedFriend() throws {
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        try start(as: .cora)
        try tap("turn.create", in: messages)
        let question = "Will the fixture finish first " + run.manifest.runID.prefix(8)
        try type(question, into: "compose.question")
        XCTAssertEqual(try control.rows("bets").count, 0, "[NATIVE-UI-CREATE-01] nothing exists before Create card")
        try tap("compose.create", in: messages)
        // The card is placed in the message field as a draft for the person to send; it names the subject and nothing else.
        let draft = messages.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Secret bet on QA Sage")).firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 20), "[NATIVE-UI-CREATE-02] the draft card is in the message field")
        _ = try required("sendButton", in: messages, "NATIVE-UI-CREATE-02")
        assertNoPrivateText(in: messages, extra: [question], "NATIVE-UI-CREATE-02")
        let bets = try control.rows("bets")
        XCTAssertEqual(bets.count, 1, "[NATIVE-UI-CREATE-03] exactly one bet")
        XCTAssertEqual(bets.first?["creator"] as? String, "cora", "[NATIVE-UI-CREATE-03]")
        XCTAssertEqual(bets.first?["subject"] as? String, "sage", "[NATIVE-UI-CREATE-03] the subject is the friend the turn assigned")
        XCTAssertEqual(bets.first?["group"] as? String, "G1", "[NATIVE-UI-CREATE-03]")
        XCTAssertEqual(bets.first?["format"] as? String, "yes_no", "[NATIVE-UI-CREATE-03]")
        XCTAssertEqual(try appCalls("v0Bets:create"), 1, "[NATIVE-UI-CREATE-04] one create request")
        XCTAssertEqual(try control.rows("turns").first?["hasBet"] as? Bool, true, "[NATIVE-UI-CREATE-05] the turn is used by this bet")
    }

    func testANewGroupIsCreatedOnlyByItsCreator() throws {
        try signIn(.oli)
        try openExtension()
        try tap(labelled("Link this conversation", in: messages, timeout: 20))
        XCTAssertFalse(element("group.link." + (try groupID("G1")), in: messages).exists, "[NATIVE-UI-GROUP-01] a group Oli is not in is not offered")
        let name = "QA New " + run.manifest.runID.prefix(8)
        try type(name, into: "group.name")
        try tap(labelled("Create and join group", in: messages))
        eventually("NATIVE-UI-GROUP-02") { try self.control.rows("groupRows").contains { $0["name"] as? String == name } }
        let created = try control.rows("groupRows").filter { $0["name"] as? String == name }
        XCTAssertEqual(created.count, 1, "[NATIVE-UI-GROUP-02] one new group")
        XCTAssertEqual(created.first?["creator"] as? String, "oli", "[NATIVE-UI-GROUP-02]")
        let members = try control.rows("memberships").filter { $0["group"] as? String == "other" }
        XCTAssertEqual(members.map { $0["actor"] as? String }, ["oli"], "[NATIVE-UI-GROUP-03] only its creator is a member; nobody is added from the conversation")
        XCTAssertEqual(try appCalls("v0Groups:create"), 1, "[NATIVE-UI-GROUP-04]")
    }
}
