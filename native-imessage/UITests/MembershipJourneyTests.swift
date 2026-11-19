import XCTest

/// Journey 9: a person joins a group only by accepting an invitation, and sees only what was created after joining.
final class MembershipJourneyTests: JourneyCase {
    private var accept: XCUIElement {
        messages.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "group.accept.")).firstMatch
    }

    func testAMemberInvitesByPhoneAndNobodyIsAddedUntilTheyAccept() throws {
        try start(as: .cora)
        try tap("navigation.groups", in: messages)
        try type(Actor.oli.phone, into: "group.invitePhone")
        try tap(labelled("Send group invitation", in: messages))
        eventually("NATIVE-UI-INVITE-01") { try self.control.rows("invites").count == 1 }
        let invite = try control.rows("invites").first
        XCTAssertEqual(invite?["group"] as? String, "G1", "[NATIVE-UI-INVITE-01]")
        XCTAssertEqual(invite?["inviter"] as? String, "cora", "[NATIVE-UI-INVITE-01]")
        XCTAssertEqual(invite?["accepted"] as? Bool, false, "[NATIVE-UI-INVITE-02] an invitation is not a membership")
        XCTAssertFalse(try control.rows("memberships").contains { $0["actor"] as? String == "oli" && $0["group"] as? String == "G1" }, "[NATIVE-UI-INVITE-02] Oli is not in the group until Oli accepts")
        XCTAssertEqual(try control.rows("outbox").count, 0, "[NATIVE-UI-INVITE-03] the invitation sends no message")
    }

    func testAnInvitedPersonJoinsByAcceptingAndSeesNoEarlierBets() throws {
        try control.seedBet("bet-a", format: "this_that")
        XCTAssertNil(try control.act("cora", "mutation", "v0Groups:invite", ["groupId": "@G1", "phone": Actor.oli.phone, "requestId": "cora-invite"]))
        try signIn(.oli)
        try openExtension()
        try tap(labelled("Link this conversation", in: messages))
        XCTAssertTrue(accept.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-JOIN-01] the invitation is offered for explicit acceptance")
        XCTAssertFalse(element("group.link." + (try groupID("G1")), in: messages).exists, "[NATIVE-UI-JOIN-02] the group cannot be linked before accepting")
        XCTAssertFalse(try control.rows("memberships").contains { $0["actor"] as? String == "oli" && $0["group"] as? String == "G1" }, "[NATIVE-UI-JOIN-02] seeing the invitation admits nobody")

        try tap(accept, scrolling: messages)
        try tap("group.link." + groupID("G1"), in: messages)
        _ = try required("navigation.board", in: messages, "NATIVE-UI-JOIN-03")
        XCTAssertTrue(try control.rows("memberships").contains { $0["actor"] as? String == "oli" && $0["group"] as? String == "G1" && $0["left"] as? Bool != true }, "[NATIVE-UI-JOIN-03] Oli is a member after accepting")
        XCTAssertEqual(try control.rows("invites").first?["accepted"] as? Bool, true, "[NATIVE-UI-JOIN-03]")
        assertText("No available bets since you joined. Earlier cards stay unavailable, including after rejoining.", in: messages, "NATIVE-UI-JOIN-04")
        XCTAssertFalse(element("group.bet." + (try betID("bet-a")), in: messages).exists, "[NATIVE-UI-JOIN-04] a bet from before joining is not listed")
        assertNoPrivateText(in: messages, "NATIVE-UI-JOIN-05")

        // A bet made after joining, through the real create handler, is listed.
        try control.seedTurn(group: "G1", creator: "cora", subject: "finn")
        let reveal = Date().timeIntervalSince1970 * 1000 + 3 * 3_600_000
        XCTAssertNil(try control.act("cora", "mutation", "v0Bets:create", [
            "groupId": "@G1", "subjectId": "@finn", "question": "A bet made after Oli joined", "contextLine": "", "format": "yes_no", "options": ["Yes", "No"],
            "cutoffAt": reveal, "revealAt": reveal, "source": "manual", "requestId": "after-join",
        ]))
        guard let later = try control.rows("bets").first(where: { $0["question"] as? String == "A bet made after Oli joined" })?["id"] as? String else {
            return XCTFail("[NATIVE-UI-JOIN-06] fixture: the later bet was not created")
        }
        try tap("navigation.board", in: messages)
        try goHome()
        _ = try required("group.bet." + later, in: messages, "NATIVE-UI-JOIN-06")
        XCTAssertFalse(element("group.bet." + (try betID("bet-a")), in: messages).exists, "[NATIVE-UI-JOIN-06] the earlier bet stays unavailable")
    }
}
