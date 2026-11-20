import XCTest

/// Journeys 1 and 2, the parts about a draft and a session: a friend who opted out cannot be made the subject, a create
/// request that is repeated makes one bet, a draft the person removed can be prepared again, a card link is only an
/// opaque locator, and a sign-out or an expired sign-in ends the session in the host app and the extension alike.
final class DraftAndSessionJourneyTests: JourneyCase {
    private let refusal = "This isn't available to your account. An earlier card may be outside your membership."
    private let failure = "Couldn't complete this request. Check your connection and try again."

    /// The card as Messages shows it in the message field. It names the subject and nothing else.
    private var draft: XCUIElement {
        messages.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Secret bet on QA Sage")).firstMatch
    }

    private func requireDraft(_ code: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(draft.waitForExistence(timeout: 20 * Self.pace), "[\(code)] the draft card is in the message field", file: file, line: line)
    }

    /// Cora, whose turn it is, opens today's bet about Sage and types a question.
    private func composeTodaysBet(_ question: String) throws {
        try control.seedTurn(group: "G1", creator: "cora", subject: "sage")
        try start(as: .cora)
        try tap("turn.create", in: messages)
        try type(question, into: "compose.question")
    }

    /// How each create request the app made ended, in order.
    private func createOutcomes() throws -> [String] {
        try control.calls().filter { $0["path"] as? String == "v0Bets:create" }.compactMap { $0["outcome"] as? String }
    }

    /// The backend applies the app's next count calls to one function, and the gateway then answers them with a server
    /// error that carries no code: the change happened and the reply was lost on the way back.
    private func loseReplies(_ path: String, count: Int) throws {
        try control.call("loseReplyNext", ["path": path, "count": count])
    }

    /// A row of the host app's form. The form is a list, so a row below the visible edge is scrolled to first.
    private func hostRow(_ id: String, _ code: String, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        if !element(id, in: host).waitForExistence(timeout: 10 * Self.pace) { host.swipeUp() }
        return try required(id, in: host, code, file: file, line: line)
    }

    /// Shows Called It in the open conversation again. Messages puts the extension away when it leaves the foreground and
    /// can do so when the message field changes; a person opens it again from the app list.
    private func showCalledIt(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        assertLabel(try required("ConversationTitle", in: messages, timeout: 30, file: file, line: line), Self.conversations[0], code, file: file, line: line)
        if !element("navigation.settings", in: messages).waitForExistence(timeout: 2 * Self.pace) {
            try tap(labelled("add", in: messages, file: file, line: line), file: file, line: line)
            try tap(labelled("Called It", .cell, in: messages, file: file, line: line), file: file, line: line)
        }
        _ = try required("navigation.settings", in: messages, timeout: 30, code, file: file, line: line)
    }

    /// Brings Messages back to the foreground without a relaunch, in the conversation it was showing, with Called It open.
    private func returnToMessages(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertTrue([.runningBackground, .runningBackgroundSuspended].contains(messages.state), "[\(code)] Messages is still running, state \(messages.state.rawValue)", file: file, line: line)
        messages.activate()
        XCTAssertTrue(messages.wait(for: .runningForeground, timeout: 60 * Self.pace), "[\(code)] Messages returns to the foreground without a relaunch", file: file, line: line)
        // A system onboarding sheet can cover Messages when it returns; a person would dismiss it.
        let sheet = messages.buttons.matching(NSPredicate(format: "label IN %@", ["OK", "Continue"])).firstMatch
        while sheet.waitForExistence(timeout: 4 * Self.pace) { sheet.tap() }
        try showCalledIt(code, file: file, line: line)
    }

    /// The extension's own sign-in control: one in the compact view, one on the full sign-in screen.
    private var signInOffer: XCUIElement {
        messages.buttons.matching(NSPredicate(format: "label IN %@", ["Sign in with your phone", "Sign in with phone number"])).firstMatch
    }

    /// What the signed-out extension must not show or do, checked while the extension is on screen.
    private func assertExtensionHoldsNothing(of key: String, since first: Int, _ code: String) throws {
        XCTAssertTrue(element("navigation.settings", in: messages).exists, "[\(code)] the extension is on screen for this check")
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[\(code)] no group is shown without a session")
        XCTAssertFalse(element("group.bet." + (try betID(key)), in: messages).exists, "[\(code)] no bet is listed without a session")
        XCTAssertFalse(element("bet.question", in: messages).exists, "[\(code)] no question is shown without a session")
        assertNoPrivateText(in: messages, code)
        let read = try control.calls().dropFirst(first).filter { $0["caller"] as? String == "CalledItExtension" && $0["outcome"] as? String == "success" }
        XCTAssertEqual(read.count, 0, "[\(code)] the extension read nothing after the session ended: \(read.compactMap { $0["path"] as? String })")
    }

    // MARK: J1.1 consenting subject

    func testAFriendWhoOptedOutCannotBeMadeTheSubjectAndIsNoLongerOffered() throws {
        try composeTodaysBet("Will the fixture arrive early")
        // Sage turns on "No bets about me" while Cora still has the form open with Sage as the subject.
        XCTAssertNil(try control.act("sage", "mutation", "v0Controls:update", ["noBets": true, "blockedTopics": [String](), "hostedAiConsent": false, "requestId": "sage-no-bets"]))
        try tap("compose.create", in: messages)
        assertText(refusal, in: messages, "NATIVE-UI-CONSENT-01")
        XCTAssertEqual(try createOutcomes(), ["NOT_AVAILABLE"], "[NATIVE-UI-CONSENT-02] the server refused the one request, and the app did not repeat it")
        XCTAssertEqual(try control.rows("bets").count, 0, "[NATIVE-UI-CONSENT-03] no bet about a friend who opted out")
        XCTAssertFalse(draft.exists, "[NATIVE-UI-CONSENT-03] no card is drafted for a refused bet")
        _ = try required("compose.question", in: messages, "NATIVE-UI-CONSENT-03")

        // Back on the group's home there is no turn to create from any more.
        let turnLoads = try appCalls("v0Groups:turn")
        try goHome()
        eventually("NATIVE-UI-CONSENT-04") { try self.appCalls("v0Groups:turn") > turnLoads }
        assertText("No creator turn available", in: messages, "NATIVE-UI-CONSENT-04")
        assertGone(element("turn.create", in: messages), "NATIVE-UI-CONSENT-04")

        // The new bet screen offers only friends who can be a subject: not Sage, not Cora herself, and nobody outside the group.
        let memberLoads = try appCalls("v0Groups:members")
        try tap("navigation.newBet", in: messages)
        eventually("NATIVE-UI-CONSENT-05") { try self.appCalls("v0Groups:members") > memberLoads }
        try tap("compose.subject", in: messages)
        let finn = try labelled("QA Finn", in: messages)
        for name in ["QA Sage", "QA Cora", "QA Oli"] {
            XCTAssertFalse(labelled(name, in: messages, timeout: 0, quiet: true), "[NATIVE-UI-CONSENT-05] \(name) is not offered as a subject")
        }
        // Choosing another friend instead, just to get a bet out, is refused too: the subject is the one the turn named.
        try tap(finn)
        try type("Will the fixture arrive late", into: "compose.question")
        try tap("compose.create", in: messages)
        eventually("NATIVE-UI-CONSENT-06") { try self.createOutcomes() == ["NOT_AVAILABLE", "FORBIDDEN"] }
        XCTAssertEqual(try control.rows("bets").count, 0, "[NATIVE-UI-CONSENT-07] still no bet")
        XCTAssertFalse(draft.exists, "[NATIVE-UI-CONSENT-07] still no card")
        _ = try required("compose.question", in: messages, "NATIVE-UI-CONSENT-07")
    }

    // MARK: J1.3 idempotent create

    func testACreateWhoseReplyIsLostIsSentAgainAsTheSameRequestAndMakesOneBet() throws {
        let question = "Will the fixture finish on time"
        try composeTodaysBet(question)
        // The server creates the bet each time it is asked, and its reply never reaches the app: three times.
        try loseReplies("v0Bets:create", count: 3)
        try tap("compose.create", in: messages)
        // The app repeats a request the server failed without a reason, twice, and then says so.
        assertText(failure, in: messages, "NATIVE-UI-IDEMPOTENT-01", timeout: 40)
        XCTAssertEqual(try createOutcomes(), ["reply_lost", "reply_lost", "reply_lost"], "[NATIVE-UI-IDEMPOTENT-02] the request reached the server three times")
        let stored = try control.rows("bets")
        XCTAssertEqual(stored.count, 1, "[NATIVE-UI-IDEMPOTENT-03] three deliveries of one request made one bet")
        XCTAssertFalse(draft.exists, "[NATIVE-UI-IDEMPOTENT-04] no card is drafted while the app has no answer")
        _ = try required("compose.question", in: messages, "NATIVE-UI-IDEMPOTENT-04")

        // The person taps Create card again. The turn is already used, so only the same request can succeed: the server
        // answers it with the bet it stored, and that bet's card is drafted.
        try tap("compose.create", in: messages)
        requireDraft("NATIVE-UI-IDEMPOTENT-05")
        XCTAssertEqual(try createOutcomes(), ["reply_lost", "reply_lost", "reply_lost", "success"], "[NATIVE-UI-IDEMPOTENT-06] the fourth delivery was accepted as the same request")
        let bets = try control.rows("bets")
        XCTAssertEqual(bets.count, 1, "[NATIVE-UI-IDEMPOTENT-07] still exactly one bet")
        XCTAssertEqual(bets.first?["id"] as? String, stored.first?["id"] as? String, "[NATIVE-UI-IDEMPOTENT-07] it is the bet the first delivery made")
        XCTAssertEqual(bets.first?["question"] as? String, question, "[NATIVE-UI-IDEMPOTENT-07]")
        XCTAssertEqual(bets.first?["subject"] as? String, "sage", "[NATIVE-UI-IDEMPOTENT-07]")
        let turns = try control.rows("turns")
        XCTAssertEqual(turns.count, 1, "[NATIVE-UI-IDEMPOTENT-08] one turn")
        XCTAssertEqual(turns.first?["hasBet"] as? Bool, true, "[NATIVE-UI-IDEMPOTENT-08] the turn is used by that bet")
        // The earlier failure is no longer on screen once the card is there.
        assertGone(text(failure, in: messages), "NATIVE-UI-IDEMPOTENT-09")
    }

    func testADoubleTapOnCreateCardMakesOneRequestAndOneBet() throws {
        try composeTodaysBet("Will the fixture win the toss")
        let done = try required("keyboard.done", in: messages, "NATIVE-UI-DOUBLETAP-01")
        done.tap()
        assertGone(done, "NATIVE-UI-DOUBLETAP-01")
        let create = try required("compose.create", in: messages, "NATIVE-UI-DOUBLETAP-01")
        for _ in 0..<6 where !create.isHittable { messages.swipeUp() }
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in create.isHittable && create.isEnabled }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30 * Self.pace), .completed, "[NATIVE-UI-DOUBLETAP-01] Create card is on screen and can be used")
        create.doubleTap()
        requireDraft("NATIVE-UI-DOUBLETAP-02")
        XCTAssertEqual(try createOutcomes(), ["success"], "[NATIVE-UI-DOUBLETAP-03] two taps sent one create request")
        XCTAssertEqual(try control.rows("bets").count, 1, "[NATIVE-UI-DOUBLETAP-04] exactly one bet")
        XCTAssertEqual(try control.rows("turns").first?["hasBet"] as? Bool, true, "[NATIVE-UI-DOUBLETAP-04]")
    }

    // MARK: J1.3 cancel and resume

    func testADraftThePersonRemovedCanBePreparedAgainFromTheSameBet() throws {
        let question = "Will the fixture bring snacks"
        try composeTodaysBet(question)
        try tap("compose.create", in: messages)
        requireDraft("NATIVE-UI-RESUME-01")
        let created = try control.rows("bets")
        XCTAssertEqual(created.count, 1, "[NATIVE-UI-RESUME-01] one bet")
        guard let id = created.first?["id"] as? String else { XCTFail("[NATIVE-UI-RESUME-01] the bet has no identifier"); throw Blocked() }
        print("JOURNEY-DISCOVERY draft staged:\n" + (try visibleContent(of: messages)) + "\nJOURNEY-DISCOVERY end")

        // The person takes the card out of the message field instead of sending it.
        try tap(labelled("Clear", in: messages))
        assertGone(draft, "NATIVE-UI-RESUME-02")
        let kept = try control.rows("bets")
        XCTAssertEqual(kept.count, 1, "[NATIVE-UI-RESUME-03] removing the draft neither removes the bet nor makes another")
        XCTAssertEqual(kept.first?["state"] as? String, "open", "[NATIVE-UI-RESUME-03] the bet stays open")
        print("JOURNEY-DISCOVERY draft removed:\n" + (try visibleContent(of: messages)) + "\nJOURNEY-DISCOVERY end")

        // The bet is still in the group, and its card can be prepared again from there.
        try showCalledIt("NATIVE-UI-RESUME-04")
        try tap(labelled("Open group", in: messages))
        try tap("group.bet." + id, in: messages, timeout: 20)
        let screen = try required("bet.screen", in: messages, timeout: 15, "NATIVE-UI-RESUME-05")
        assertLabel(try required("bet.question", in: screen), question, "NATIVE-UI-RESUME-05")
        try tap("bet.sendUpdate", in: messages)
        requireDraft("NATIVE-UI-RESUME-06")
        XCTAssertEqual(try createOutcomes(), ["success"], "[NATIVE-UI-RESUME-07] preparing the card again creates nothing")
        let bets = try control.rows("bets")
        XCTAssertEqual(bets.count, 1, "[NATIVE-UI-RESUME-07] still the one bet")
        XCTAssertEqual(bets.first?["id"] as? String, id, "[NATIVE-UI-RESUME-07]")
    }

    // MARK: J2.1 opaque locator

    func testACardLinkIsOnlyAnOpaqueLocatorInTheHostAppAndASignedInMemberReachesItsBet() throws {
        try control.seedBet("bet-a", format: "this_that")
        let id = try betID("bet-a")
        guard let locator = try bet("bet-a")["locator"] as? String, !locator.isEmpty else { XCTFail("[NATIVE-UI-LOCATOR-01] the bet has no locator"); throw Blocked() }
        XCTAssertNotNil(locator.range(of: "^[A-Za-z0-9_-]{32,256}$", options: .regularExpression), "[NATIVE-UI-LOCATOR-01] the locator is one opaque token")
        for known in try [id, groupID("G1"), accountID(.cora), accountID(.sage)] {
            XCTAssertFalse(locator.contains(known), "[NATIVE-UI-LOCATOR-01] the locator carries no bet, group or account identifier")
        }
        let origin = run.manifest.cardOrigin.hasSuffix("/") ? String(run.manifest.cardOrigin.dropLast()) : run.manifest.cardOrigin
        guard let cardLink = URL(string: origin + "/c/" + locator), let enriched = URL(string: origin + "/c/" + locator + "?bet=" + id) else {
            XCTFail("[NATIVE-UI-LOCATOR-01] the card link could not be built"); throw Blocked()
        }

        // Signed out, a link that says anything besides the locator is refused and nothing is kept.
        _ = try launchHostSignedOut()
        host.open(enriched)
        _ = try hostRow("auth.error", "NATIVE-UI-LOCATOR-02")
        XCTAssertFalse(element("auth.pendingCard", in: host).exists, "[NATIVE-UI-LOCATOR-02] a link with more than a locator is not kept")

        // The card's own link is kept as a waiting card. The host app shows nothing of the bet and asks the server nothing.
        host.open(cardLink)
        _ = try hostRow("auth.pendingCard", "NATIVE-UI-LOCATOR-03")
        print("JOURNEY-DISCOVERY host with a waiting card:\n" + (try visibleContent(of: host)) + "\nJOURNEY-DISCOVERY end")
        assertNoPrivateText(in: host, extra: [locator, id], "NATIVE-UI-LOCATOR-04")
        XCTAssertFalse(element("auth.returnToMessages", in: host).exists, "[NATIVE-UI-LOCATOR-04] opening a card signs nobody in")
        XCTAssertEqual(try control.calls().filter { ($0["path"] as? String ?? "").hasPrefix("v0Bets:") }.count, 0, "[NATIVE-UI-LOCATOR-05] no bet was asked for without a sign-in")

        // After the sign-in the card is still waiting, and the host app still reads no bet: it sends the person back to Messages.
        try signIn(.finn)
        _ = try hostRow("auth.pendingCard", "NATIVE-UI-LOCATOR-06")
        assertNoPrivateText(in: host, extra: [locator, id], "NATIVE-UI-LOCATOR-06")
        XCTAssertEqual(try control.calls().filter { ($0["path"] as? String ?? "").hasPrefix("v0Bets:") }.count, 0, "[NATIVE-UI-LOCATOR-06] the host app reads no bet")

        // In Messages the member's bet screen is addressed by that locator, and it is the original bet.
        try openExtension()
        try link("G1")
        let screen = try openBet("bet-a")
        assertLabel(try required("bet.question", in: screen), run.secretQuestion, "NATIVE-UI-LOCATOR-07")
        XCTAssertGreaterThanOrEqual(try appCalls("v0Bets:get"), 1, "[NATIVE-UI-LOCATOR-07] the bet was read by its locator")
    }

    // MARK: J2.2 logout and expiry

    func testSigningOutInTheHostAppSignsTheExtensionOut() throws {
        try control.seedBet("bet-a", format: "this_that")
        try start(as: .finn)
        _ = try required("group.bet." + betID("bet-a"), in: messages, "NATIVE-UI-LOGOUT-01")
        let before = try control.calls().count

        host.activate()
        try tap("auth.signOut", in: host)
        _ = try required("auth.phone", in: host, timeout: 15, "NATIVE-UI-LOGOUT-02")
        assertGone(element("auth.signOut", in: host), "NATIVE-UI-LOGOUT-02")
        let sessions = try appSessions(.finn)
        XCTAssertEqual(sessions.count, 1, "[NATIVE-UI-LOGOUT-03] one sign-in")
        XCTAssertEqual(sessions.first?["revoked"] as? Bool, true, "[NATIVE-UI-LOGOUT-03] the server revoked it")
        XCTAssertEqual(try appCalls("v0Auth:revoke"), 1, "[NATIVE-UI-LOGOUT-03]")

        try returnToMessages("NATIVE-UI-LOGOUT-04")
        XCTAssertTrue(signInOffer.waitForExistence(timeout: 20 * Self.pace), "[NATIVE-UI-LOGOUT-05] the extension asks for a sign-in")
        try assertExtensionHoldsNothing(of: "bet-a", since: before, "NATIVE-UI-LOGOUT-06")
    }

    func testSigningOutInTheExtensionSignsTheHostAppOut() throws {
        try control.seedBet("bet-a", format: "this_that")
        try start(as: .finn)
        _ = try required("group.bet." + betID("bet-a"), in: messages, "NATIVE-UI-LOGOUT-07")
        try tap("navigation.settings", in: messages)
        try tap("settings.signOut", in: messages)
        _ = try required("openPhoneSignIn", in: messages, timeout: 20, "NATIVE-UI-LOGOUT-08")
        let sessions = try appSessions(.finn)
        XCTAssertEqual(sessions.count, 1, "[NATIVE-UI-LOGOUT-09] one sign-in")
        XCTAssertEqual(sessions.first?["revoked"] as? Bool, true, "[NATIVE-UI-LOGOUT-09] the server revoked it")
        XCTAssertEqual(try appCalls("v0Auth:revoke"), 1, "[NATIVE-UI-LOGOUT-09]")
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-LOGOUT-10] no group is shown after the sign-out")
        assertNoPrivateText(in: messages, "NATIVE-UI-LOGOUT-10")

        // The host app, brought back without a relaunch, is signed out as well and asks for the phone number again.
        host.activate()
        _ = try required("auth.phone", in: host, timeout: 20, "NATIVE-UI-LOGOUT-11")
        XCTAssertFalse(element("auth.signOut", in: host).exists, "[NATIVE-UI-LOGOUT-11] the host app holds no session")
        XCTAssertFalse(element("auth.returnToMessages", in: host).exists, "[NATIVE-UI-LOGOUT-11]")
        XCTAssertEqual(try appCalls("v0Auth:revoke"), 1, "[NATIVE-UI-LOGOUT-12] one sign-out, not one per app")
    }

    func testAnExpiredSignInEndsTheSessionInTheExtensionAndTheHostApp() throws {
        try control.seedBet("bet-a", format: "this_that")
        try start(as: .finn)
        _ = try required("group.bet." + betID("bet-a"), in: messages, "NATIVE-UI-EXPIRY-01")
        // The sign-in runs out on the server. Nobody signed out.
        let expired = (try control.call("expireSessions", ["actor": "finn"]) as? [String: Any])?["expired"] as? Int
        XCTAssertEqual(expired, 1, "[NATIVE-UI-EXPIRY-02] the one app sign-in is past its expiry")
        let sessions = try appSessions(.finn)
        XCTAssertEqual(sessions.first?["expired"] as? Bool, true, "[NATIVE-UI-EXPIRY-02]")
        XCTAssertEqual(sessions.first?["revoked"] as? Bool, false, "[NATIVE-UI-EXPIRY-02] expired, not revoked")
        let before = try control.calls().count

        // The next thing the person opens is refused, and the extension goes back to asking for a sign-in.
        try tap("navigation.board", in: messages)
        _ = try required("openPhoneSignIn", in: messages, timeout: 20, "NATIVE-UI-EXPIRY-03")
        assertText("Sign in again in the Called It app.", in: messages, "NATIVE-UI-EXPIRY-03")
        XCTAssertGreaterThanOrEqual(try appCalls("v0Groups:board", outcome: "AUTH_REQUIRED"), 1, "[NATIVE-UI-EXPIRY-04] the server refused the expired sign-in")
        try assertExtensionHoldsNothing(of: "bet-a", since: before, "NATIVE-UI-EXPIRY-05")

        // The host app shares that session, so it is signed out too.
        host.activate()
        _ = try required("auth.phone", in: host, timeout: 20, "NATIVE-UI-EXPIRY-06")
        XCTAssertFalse(element("auth.signOut", in: host).exists, "[NATIVE-UI-EXPIRY-06] the host app holds no session")
        XCTAssertEqual(try appCalls("v0Auth:revoke"), 0, "[NATIVE-UI-EXPIRY-07] nothing was revoked: the sign-in expired")
    }
}
