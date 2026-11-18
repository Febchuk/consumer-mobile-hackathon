import XCTest

/// Journey 4: the person a bet is about sees a sealed card and nothing else, and can quietly veto it.
final class SubjectPrivacyJourneyTests: JourneyCase {
    func testSubjectSeesOnlyTheSealedCard() throws {
        try control.seedBet("bet-a", format: "this_that")
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 0, "confidence": 0.8, "requestId": "finn-pick"]))
        try start(as: .sage)
        let row = try required("group.bet." + betID("bet-a"), in: messages)
        XCTAssertTrue(row.label.contains("A hidden bet about you"), "[NATIVE-UI-LOCK-01] the list names no question: \(row.label)")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-LOCK-02")

        let screen = try openBet("bet-a")
        _ = try required("bet.sealed", in: screen, "NATIVE-UI-LOCK-03")
        assertText("A secret bet about you", in: screen, "NATIVE-UI-LOCK-03")
        assertText("1 friends are in", in: screen, "NATIVE-UI-LOCK-04")
        XCTAssertFalse(element("bet.question", in: messages).exists, "[NATIVE-UI-LOCK-05] no question for the subject")
        XCTAssertFalse(element("bet.confirmPick", in: messages).exists, "[NATIVE-UI-LOCK-05] the subject cannot pick")
        XCTAssertFalse(element("bet.option.0", in: messages).exists, "[NATIVE-UI-LOCK-05]")
        XCTAssertFalse(element("bet.answer.0", in: messages).exists, "[NATIVE-UI-LOCK-05] no answer before the reveal")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-LOCK-06")

        // Tapping the sealed panel must not open it.
        try tap("bet.sealed", in: screen)
        _ = try required("bet.sealed", in: screen, "NATIVE-UI-LOCK-07")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-LOCK-08")
    }

    func testSubjectVetoesInOneTapAndThePickIsVoided() throws {
        try control.seedBet("bet-a", format: "yes_no")
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:bet-a", "option": 0, "confidence": 0.8, "requestId": "finn-pick"]))
        try start(as: .sage)
        let screen = try openBet("bet-a")
        try tap("bet.veto", in: screen)
        _ = try required("bet.unavailable", in: messages, "NATIVE-UI-VETO-01")
        assertGone(element("bet.sealed", in: messages), "NATIVE-UI-VETO-02")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-VETO-03")
        XCTAssertEqual(try bet("bet-a")["state"] as? String, "voided", "[NATIVE-UI-VETO-04] the server voided the bet")
        XCTAssertEqual(try control.rows("picks").first?["voided"] as? Bool, true, "[NATIVE-UI-VETO-05] the friend's pick is voided")
        XCTAssertEqual(try control.rows("ledger").count, 0, "[NATIVE-UI-VETO-06] nothing is scored")
        XCTAssertEqual(try appCalls("v0Bets:veto"), 1, "[NATIVE-UI-VETO-07]")
    }

    func testAFriendStillSeesTheQuestionTheSubjectCannot() throws {
        try control.seedBet("bet-a", format: "yes_no")
        try start(as: .finn)
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.question", in: screen), run.secretQuestion, "NATIVE-UI-LOCK-09")
        XCTAssertFalse(element("bet.sealed", in: messages).exists, "[NATIVE-UI-LOCK-10]")
        XCTAssertFalse(element("bet.veto", in: messages).exists, "[NATIVE-UI-LOCK-10] only the subject can veto")
    }

    func testAnOutsiderSeesNeitherTheGroupNorTheBet() throws {
        try control.seedBet("bet-a", format: "yes_no")
        try signIn(.oli)
        try openExtension()
        try tap(labelled("Link this conversation", in: messages, timeout: 20))
        let first = try groupID("G1"), second = try groupID("G2"), hidden = try betID("bet-a")
        _ = try required("group.link." + second, in: messages, "NATIVE-UI-OUTSIDER-01")
        XCTAssertFalse(element("group.link." + first, in: messages).exists, "[NATIVE-UI-OUTSIDER-02] a group Oli is not in is not offered")
        try tap("group.link." + second, in: messages)
        _ = try required("navigation.board", in: messages, timeout: 15)
        assertText("No available bets since you joined. Earlier cards stay unavailable, including after rejoining.", in: messages, "NATIVE-UI-OUTSIDER-03")
        XCTAssertFalse(element("group.bet." + hidden, in: messages).exists, "[NATIVE-UI-OUTSIDER-04]")
        try assertNoPrivateContent(in: messages, "NATIVE-UI-OUTSIDER-05")
    }
}
