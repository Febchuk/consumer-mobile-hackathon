import XCTest

/// Notifications in the host app: the preference switch, and what the app does when a notification arrives.
///
/// An arrival is staged by handing the run's own simulator a payload with simctl push (the control operation
/// notifyPush). The payload is the one the product's worker would send for a real outbox row: the worker's alert text,
/// the row's kind and its opaque identifiers. That is a mock of the transport. It shows what the app displays, where a
/// tap leads and that nothing private is on screen; it never shows that the server or Apple delivered anything.
final class NotificationJourneyTests: JourneyCase {
    private typealias Pick = (actor: String, option: Int, confidence: Double)

    /// The status line once iOS allows alerts. The QA build asks for the local permission and never registers with a provider.
    private static let allowed = "Allowed. QA provider delivery disabled"
    private static let alertBody = "Open Called It for an update."
    private static let notAvailable = "This isn't available to your account. An earlier card may be outside your membership."
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    /// On failure, also keep what the host app and the system showed: these tests never open Messages.
    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            if let host, host.state == .runningForeground, let content = try? visibleContent(of: host) { print("JOURNEY-DIAGNOSTIC host:\n" + content + "\nJOURNEY-DIAGNOSTIC end") }
            if let content = try? visibleContent(of: springboard) { print("JOURNEY-DIAGNOSTIC springboard:\n" + String(content.prefix(6000)) + "\nJOURNEY-DIAGNOSTIC end") }
        }
        try super.tearDownWithError()
    }

    // MARK: Helpers

    private func holds(_ code: String, _ what: String, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line, _ condition: @escaping () -> Bool) {
        let reached = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [reached], timeout: timeout * Self.pace), .completed, "[\(code)] \(what)", file: file, line: line)
    }

    /// The host form builds its rows as they scroll into view, so a row further down is scrolled to, one swipe at a time.
    @discardableResult
    private func bring(_ target: XCUIElement, _ what: String, _ code: String, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        for _ in 0..<6 where !(target.waitForExistence(timeout: 2 * Self.pace) && target.isHittable) { host.swipeUp() }
        guard target.waitForExistence(timeout: 10 * Self.pace), target.isHittable else {
            XCTFail("[\(code)] \(what) did not come on screen in the host app", file: file, line: line)
            throw Blocked()
        }
        return target
    }

    private func preference(_ actor: Actor) throws -> Bool? {
        try control.rows("accountRows").first { $0["actor"] as? String == actor.rawValue }?["notificationsEnabled"] as? Bool
    }

    /// Flips the notifications switch and requires the new state on the switch and on the server. Turning it on is where
    /// the app asks iOS for permission. iOS asks a person once per installation, so the alert is there for the first test
    /// on a simulator and not for a later one: either the alert is on screen and is answered with Allow, or the status
    /// line already says alerts are allowed. Anything else fails.
    private func setAlerts(_ on: Bool, for actor: Actor, _ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let toggle = try bring(element("notifications.enable", in: host), "the notifications switch", code, file: file, line: line)
        holds(code, "the switch is \(on ? "off" : "on") and can be used before it is flipped", file: file, line: line) { toggle.isEnabled && toggle.value as? String == (on ? "0" : "1") }
        // A tap that lands while the form is still moving from a scroll only stops the scroll, so the row has to stay put first.
        var last = CGRect.null
        holds(code, "the switch has come to rest on screen", file: file, line: line) {
            let now = toggle.frame
            defer { last = now }
            return now == last && toggle.isHittable
        }
        let saves = { try self.control.calls().filter { $0["path"] as? String == "v0Notifications:setPreferences" }.count }
        let before = try saves()
        // The row is the element with the identifier; the control inside it is what a finger touches. Where the row
        // exposes it, that is what gets tapped, and otherwise the row's trailing edge, where the control sits.
        let inner = toggle.switches.firstMatch
        let flip = { if inner.exists { inner.tap() } else { toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap() } }
        print("JOURNEY-DIAGNOSTIC switch: inner control \(inner.exists ? "tapped" : "not exposed, trailing edge tapped")")
        flip()
        // On a hosted runner the switch has ignored a tap after the app was relaunched: it did not move and the app asked
        // the server for nothing. A person would tap again. One more tap is allowed, and written to the run's evidence.
        let reacted = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in toggle.value as? String == (on ? "1" : "0") || ((try? saves()) ?? before) > before }, object: nil)
        if XCTWaiter.wait(for: [reacted], timeout: 10 * Self.pace) != .completed {
            try recordRetry("retap", "the notifications switch did not react to a tap: it stayed \(on ? "off" : "on") and the app saved nothing")
            flip()
        }
        if on {
            let allow = springboard.buttons["Allow"]
            let status = element("notifications.status", in: host)
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in allow.exists || (status.exists && status.label == Self.allowed) }, object: nil)
            guard XCTWaiter.wait(for: [settled], timeout: 30 * Self.pace) == .completed else {
                XCTFail("[\(code)] turning alerts on neither asked for permission nor showed it as allowed", file: file, line: line)
                throw Blocked()
            }
            if allow.exists { allow.tap() }
            assertLabel(try bring(status, "the notifications status", code, file: file, line: line), Self.allowed, code, timeout: 30, file: file, line: line)
        }
        holds(code, "the switch shows \(on ? "on" : "off")", file: file, line: line) { toggle.exists && toggle.value as? String == (on ? "1" : "0") }
        eventually(code, file: file, line: line) { try self.preference(actor) == on }
    }

    /// Makes sure iOS allows this app's alerts, the way a person would: by turning the switch off and on again and
    /// answering the system alert. A simulator that already allowed them in an earlier test is left as it is.
    private func allowAlerts(for actor: Actor, file: StaticString = #filePath, line: UInt = #line) throws {
        let status = try bring(element("notifications.status", in: host), "the notifications status", "NATIVE-UI-NOTIFY-PERMISSION", file: file, line: line)
        let already = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in status.exists && status.label == Self.allowed }, object: nil)
        if XCTWaiter.wait(for: [already], timeout: 5 * Self.pace) == .completed { return }
        try setAlerts(false, for: actor, "NATIVE-UI-NOTIFY-PERMISSION", file: file, line: line)
        try setAlerts(true, for: actor, "NATIVE-UI-NOTIFY-PERMISSION", file: file, line: line)
    }

    /// Hands the simulator the notification for one real outbox row, or again one this test already delivered, and
    /// returns the banner iOS shows for it. The reply names the payload's fields, never their values.
    private func deliver(_ arguments: [String: Any], _ code: String, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        let reply = try control.call("notifyPush", arguments) as? [String: Any]
        XCTAssertEqual(reply?["body"] as? String, Self.alertBody, "[\(code)] the alert is the worker's neutral text", file: file, line: line)
        let fields = Set(reply?["fields"] as? [String] ?? [])
        XCTAssertTrue(fields.isSubset(of: ["aps", "kind", "groupId", "locator"]) && fields.isSuperset(of: ["aps", "kind"]), "[\(code)] the payload carries only its alert, kind and opaque identifiers, found \(fields.sorted())", file: file, line: line)
        let banner = springboard.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ OR label CONTAINS %@", "NotificationShortLookView", Self.alertBody)).firstMatch
        guard banner.waitForExistence(timeout: 30 * Self.pace) else {
            XCTFail("[\(code)] iOS showed no banner for the notification", file: file, line: line)
            throw Blocked()
        }
        return banner
    }

    /// Taps a banner and requires the host app in front with the section a notification opens.
    private func open(_ banner: XCUIElement, _ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        banner.tap()
        XCTAssertTrue(host.wait(for: .runningForeground, timeout: 30 * Self.pace), "[\(code)] the tap brings the host app to the front", file: file, line: line)
        // The section a notification opens ends with this button; with it on screen the whole section is.
        try bring(closeButton, "the section a notification opens", code, file: file, line: line)
        _ = try required("notifications.destination", in: host, code, file: file, line: line)
    }

    private var closeButton: XCUIElement {
        host.buttons.matching(NSPredicate(format: "label == %@", "Close notification")).firstMatch
    }

    private func close(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        try tap(closeButton, scrolling: host, file: file, line: line)
        assertGone(closeButton, code, file: file, line: line)
        assertGone(element("notifications.destination", in: host), code, file: file, line: line)
    }

    /// A banner leaves by itself after a few seconds. Waiting for that keeps the next one from being mistaken for it.
    private func gone(_ banner: XCUIElement, _ code: String, file: StaticString = #filePath, line: UInt = #line) {
        assertGone(banner, code, timeout: 30, file: file, line: line)
    }

    private func assertNoProviderRegistration(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertEqual(try control.inspect()["pushTokens"] as? Int, 0, "[\(code)] no device token was stored", file: file, line: line)
        XCTAssertEqual(try control.calls().filter { $0["path"] as? String == "v0Notifications:register" }.count, 0, "[\(code)] the app never tried to register a device token", file: file, line: line)
    }

    private func outbox(_ kind: String, bet key: String? = nil) throws -> [String] {
        let id = try key.map { try betID($0) }
        return try control.rows("outbox").filter { $0["kind"] as? String == kind && (id == nil || $0["betId"] as? String == id) }.compactMap { $0["actor"] as? String }.sorted()
    }

    /// A fixture bet about Sage that Finn picked on, moved to its reveal by the product's sweep, which queues the reveals.
    private func revealedBet(_ key: String, file: StaticString = #filePath, line: UInt = #line) throws {
        try control.seedBet(key)
        XCTAssertNil(try control.act("finn", "mutation", "v0Bets:pick", ["betId": "@bet:" + key, "option": 0, "confidence": 0.7, "requestId": key + "-pick-finn"]), "[NATIVE-UI-NOTIFY-FIXTURE] Finn picks on \(key)", file: file, line: line)
        try control.shiftBet(key, to: "revealed")
        XCTAssertEqual(try bet(key)["state"] as? String, "revealed", "[NATIVE-UI-NOTIFY-FIXTURE] the product's sweep revealed \(key)", file: file, line: line)
    }

    /// One fixture bet from picks to its final result, through the public handlers and the product's sweep.
    private func settle(_ key: String, question: String, picks: [Pick], file: StaticString = #filePath, line: UInt = #line) throws {
        try control.seedBet(key, question: question)
        for pick in picks {
            XCTAssertNil(try control.act(pick.actor, "mutation", "v0Bets:pick", ["betId": "@bet:" + key, "option": pick.option, "confidence": pick.confidence, "requestId": key + "-pick-" + pick.actor]), "[NATIVE-UI-NOTIFY-FIXTURE] \(pick.actor) picks on \(key)", file: file, line: line)
        }
        try control.shiftBet(key, to: "revealed")
        XCTAssertNil(try control.act("sage", "mutation", "v0Bets:answer", ["betId": "@bet:" + key, "option": 0, "requestId": key + "-answer"]), "[NATIVE-UI-NOTIFY-FIXTURE] Sage answers \(key)", file: file, line: line)
        try control.shiftBet(key, to: "challengeOver")
        XCTAssertEqual(try bet(key)["state"] as? String, "finalized", "[NATIVE-UI-NOTIFY-FIXTURE] the product's sweep finalized \(key)", file: file, line: line)
    }

    private func relaunchSignedIn(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let loads = try appCalls("v0Notifications:preferences")
        host.terminate()
        host.launchEnvironment = run.launchEnvironment
        host.launch()
        _ = try required("auth.signOut", in: host, timeout: 30, code, file: file, line: line)
        // The switch is drawn from the preference the app reads at launch; nothing is tapped before that read is back.
        eventually(code, timeout: 30, file: file, line: line) { try self.appCalls("v0Notifications:preferences") > loads }
    }

    // MARK: J7.3 and N3: the preference

    func testThePreferenceSwitchSavesToTheServerAndIsShownAgainAfterARelaunch() throws {
        try revealedBet("bet-a")
        XCTAssertEqual(try outbox("reveal", bet: "bet-a"), ["finn", "sage"], "[NATIVE-UI-NOTIFY-PREF-00] fixture: a reveal is queued for Finn and for Sage")

        try signIn(.finn)
        let toggle = try bring(element("notifications.enable", in: host), "the notifications switch", "NATIVE-UI-NOTIFY-PREF-01")
        holds("NATIVE-UI-NOTIFY-PREF-01", "alerts are on to begin with") { toggle.value as? String == "1" }
        XCTAssertNil(try preference(.finn), "[NATIVE-UI-NOTIFY-PREF-01] nothing is stored until the person chooses")

        // Off: saved on the server, which drops what was queued for Finn and queues nothing new for him.
        try setAlerts(false, for: .finn, "NATIVE-UI-NOTIFY-PREF-02")
        XCTAssertEqual(try outbox("reveal", bet: "bet-a"), ["sage"], "[NATIVE-UI-NOTIFY-PREF-03] the server dropped Finn's queued reveal and kept Sage's")
        try revealedBet("bet-b")
        XCTAssertEqual(try outbox("reveal", bet: "bet-b"), ["sage"], "[NATIVE-UI-NOTIFY-PREF-03] the next reveal is queued for Sage only")

        // The saved state is what the app shows after it was closed and opened again.
        try relaunchSignedIn("NATIVE-UI-NOTIFY-PREF-04")
        let reopened = try bring(element("notifications.enable", in: host), "the notifications switch", "NATIVE-UI-NOTIFY-PREF-04")
        holds("NATIVE-UI-NOTIFY-PREF-04", "the switch is still off after a relaunch") { reopened.value as? String == "0" }

        // On again: saved, shown again after a relaunch, and the server queues for Finn again.
        try setAlerts(true, for: .finn, "NATIVE-UI-NOTIFY-PREF-05")
        try revealedBet("bet-c")
        XCTAssertEqual(try outbox("reveal", bet: "bet-c"), ["finn", "sage"], "[NATIVE-UI-NOTIFY-PREF-06] the next reveal is queued for Finn again")
        try relaunchSignedIn("NATIVE-UI-NOTIFY-PREF-07")
        let again = try bring(element("notifications.enable", in: host), "the notifications switch", "NATIVE-UI-NOTIFY-PREF-07")
        holds("NATIVE-UI-NOTIFY-PREF-07", "the switch is on after a relaunch") { again.value as? String == "1" }
        XCTAssertEqual(try preference(.finn), true, "[NATIVE-UI-NOTIFY-PREF-07]")
        XCTAssertEqual(try appCalls("v0Notifications:setPreferences"), 2, "[NATIVE-UI-NOTIFY-PREF-08] one save for each flip of the switch")
        try assertNoProviderRegistration("NATIVE-UI-NOTIFY-PREF-09")
    }

    // MARK: N2: an arrival while the app is in front

    func testARevealArrivingInFrontIsNeutralOpensItsBetAndALateCopyAfterLeavingShowsNothing() throws {
        // Permission first: turning the switch off to get there drops whatever the server had queued for this person.
        try signIn(.finn)
        try allowAlerts(for: .finn)
        try revealedBet("bet-a")
        XCTAssertEqual(try outbox("reveal", bet: "bet-a"), ["finn", "sage"], "[NATIVE-UI-NOTIFY-FRONT-00] fixture: a reveal is queued for Finn and for Sage")

        // The banner over the open app, and everything else the system shows with it, says nothing about the bet.
        let first = try deliver(["actor": "finn", "kind": "reveal", "bet": "bet-a", "remember": "reveal"], "NATIVE-UI-NOTIFY-FRONT-01")
        let shown = try visibleContent(of: springboard)
        XCTAssertTrue(shown.contains(Self.alertBody), "[NATIVE-UI-NOTIFY-FRONT-02] the banner must be on screen for this check to mean anything")
        for sentinel in run.privateSentinels + ["QA Sage", "QA Cora", "QA Finn", "QA G1"] {
            XCTAssertFalse(shown.contains(sentinel), "[NATIVE-UI-NOTIFY-FRONT-02] \(sentinel.prefix(18))… is in what the system shows with the banner")
        }
        gone(first, "NATIVE-UI-NOTIFY-FRONT-02")

        // The same arrival again, tapped: the app asks the server for the bet the payload names and shows it.
        let banner = try deliver(["replay": "reveal"], "NATIVE-UI-NOTIFY-FRONT-03")
        let asked = try appCalls("v0Bets:get")
        try open(banner, "NATIVE-UI-NOTIFY-FRONT-03")
        assertText(run.secretQuestion, in: host, "NATIVE-UI-NOTIFY-FRONT-04")
        assertText("Revealed", in: host, "NATIVE-UI-NOTIFY-FRONT-04")
        assertText("To act, reopen the original card or linked group in Messages. This alert doesn't link or send to a conversation.", in: host, "NATIVE-UI-NOTIFY-FRONT-04")
        XCTAssertGreaterThan(try appCalls("v0Bets:get"), asked, "[NATIVE-UI-NOTIFY-FRONT-05] the bet was read from the server when the notification was opened")
        try close("NATIVE-UI-NOTIFY-FRONT-06")

        // Finn leaves the group. A late copy of the same notification opens the app, the server refuses the bet, and
        // nothing of it is shown.
        XCTAssertNil(try control.act("finn", "mutation", "v0Controls:leave", ["groupId": "@G1", "requestId": "finn-leaves"]), "[NATIVE-UI-NOTIFY-STALE-00] fixture: leaving was refused")
        let late = try deliver(["replay": "reveal"], "NATIVE-UI-NOTIFY-STALE-01")
        let refusedBefore = try appCalls("v0Bets:get", outcome: "NOT_AVAILABLE")
        let readBefore = try appCalls("v0Bets:get")
        try open(late, "NATIVE-UI-NOTIFY-STALE-01")
        assertText(Self.notAvailable, in: host, "NATIVE-UI-NOTIFY-STALE-02")
        XCTAssertGreaterThan(try appCalls("v0Bets:get", outcome: "NOT_AVAILABLE"), refusedBefore, "[NATIVE-UI-NOTIFY-STALE-03] the server refused the bet at open")
        XCTAssertEqual(try appCalls("v0Bets:get"), readBefore, "[NATIVE-UI-NOTIFY-STALE-03] and the bet was not read again")
        XCTAssertFalse(text("Revealed", in: host).exists || text(run.secretQuestion, in: host).exists, "[NATIVE-UI-NOTIFY-STALE-04] neither the bet nor its state is shown")
        assertNoPrivateText(in: host, "NATIVE-UI-NOTIFY-STALE-04")
        try assertNoProviderRegistration("NATIVE-UI-NOTIFY-STALE-05")
    }

    // MARK: J3.1 and N2: an arrival while the app is in the background

    func testATurnArrivingInTheBackgroundIsNeutralAndOpensTheCreatorTurn() throws {
        // Permission first, as whoever: it belongs to the phone, and getting it drops what was queued for that person.
        try signIn(.cora)
        try allowAlerts(for: .cora)
        // The product's own turns job assigns today's turn and queues its notification.
        try control.runJob("turns")
        let queued = try control.rows("outbox").filter { $0["kind"] as? String == "turn" && $0["group"] as? String == "G1" }
        XCTAssertEqual(queued.count, 1, "[NATIVE-UI-NOTIFY-TURN-00] fixture: one turn notification is queued for G1")
        let turn = try control.rows("turns").first { $0["group"] as? String == "G1" }
        guard let name = queued.first?["actor"] as? String, let creator = Actor(rawValue: name), let subject = (turn?["subject"] as? String).flatMap(Actor.init(rawValue:)) else {
            XCTFail("[NATIVE-UI-NOTIFY-TURN-00] fixture: the turn notification names no fixture person")
            throw Blocked()
        }
        XCTAssertEqual(turn?["creator"] as? String, name, "[NATIVE-UI-NOTIFY-TURN-00] it is queued for the day's creator")

        if creator != .cora {
            try signIn(creator)
            assertLabel(try bring(element("notifications.status", in: host), "the notifications status", "NATIVE-UI-NOTIFY-TURN-01"), Self.allowed, "NATIVE-UI-NOTIFY-TURN-01")
        }
        XCUIDevice.shared.press(.home)
        holds("NATIVE-UI-NOTIFY-TURN-01", "the host app is in the background") { self.host.state == .runningBackground || self.host.state == .runningBackgroundSuspended }

        let banner = try deliver(["actor": name, "kind": "turn", "group": "G1"], "NATIVE-UI-NOTIFY-TURN-02")
        let label = banner.label
        XCTAssertFalse(label.contains(subject.alias) || label.contains("QA G1"), "[NATIVE-UI-NOTIFY-TURN-03] the banner names neither the friend the turn is about nor the group")
        let asked = try appCalls("v0Groups:turn")
        try open(banner, "NATIVE-UI-NOTIFY-TURN-04")
        assertText("Creator turn: assigned", in: host, "NATIVE-UI-NOTIFY-TURN-05")
        assertText("Return to the linked group in Messages to create or pass your turn.", in: host, "NATIVE-UI-NOTIFY-TURN-05")
        XCTAssertGreaterThan(try appCalls("v0Groups:turn"), asked, "[NATIVE-UI-NOTIFY-TURN-06] the turn was read from the server when the notification was opened")
        XCTAssertEqual(messages.state, .notRunning, "[NATIVE-UI-NOTIFY-TURN-07] opening the notification did not open Messages")
        try assertNoProviderRegistration("NATIVE-UI-NOTIFY-TURN-08")
    }

    // MARK: J7.3: the recap as displayed

    func testARecapArrivalShowsTheWeeksPointsFromTheLedger() throws {
        try settle("bet-1", question: "Synthetic question one", picks: [("finn", 0, 0.7), ("cora", 0, 0.01)])
        try settle("bet-2", question: "Synthetic question two", picks: [("finn", 0, 0.35), ("cora", 1, 1)])
        var points: [String: Int] = [:]
        for row in try control.rows("ledger") where row["group"] as? String == "G1" { points[row["actor"] as? String ?? "?", default: 0] += row["points"] as? Int ?? 0 }
        XCTAssertEqual(points, ["finn": 109, "cora": 1], "[NATIVE-UI-NOTIFY-RECAP-00] fixture: the week's ledger")
        try signIn(.finn)
        try allowAlerts(for: .finn)
        // The week is closed by the fixture, since the server clock cannot move to the weekly hour; the notifications are
        // queued by the product's own queue.
        try control.call("notifySeedRecap", ["group": "G1"])
        XCTAssertEqual(try outbox("recap"), ["cora", "finn", "sage"], "[NATIVE-UI-NOTIFY-RECAP-00] fixture: one recap notification for each member of G1")
        let banner = try deliver(["actor": "finn", "kind": "recap", "group": "G1"], "NATIVE-UI-NOTIFY-RECAP-01")
        let label = banner.label
        XCTAssertFalse(label.contains("109") || label.contains("QA "), "[NATIVE-UI-NOTIFY-RECAP-02] the banner carries no points and no names")
        try open(banner, "NATIVE-UI-NOTIFY-RECAP-03")
        assertText("Weekly group recap", in: host, "NATIVE-UI-NOTIFY-RECAP-04")
        XCTAssertGreaterThan(try appCalls("v0Groups:recap"), 0, "[NATIVE-UI-NOTIFY-RECAP-05] the recap was read from the server when the notification was opened")
        // Each person with points this week has one row with the ledger's sum, highest first; Sage, the subject, has none.
        var rows: [CGRect] = []
        for (actor, sum) in [(Actor.finn, 109), (Actor.cora, 1)] {
            let alias = try bring(host.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", actor.alias)).firstMatch, "\(actor.alias)'s recap row", "NATIVE-UI-NOTIFY-RECAP-06")
            let total = try bring(host.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "\(sum) points")).firstMatch, "\(actor.alias)'s points", "NATIVE-UI-NOTIFY-RECAP-06")
            XCTAssertLessThan(abs(alias.frame.midY - total.frame.midY), 4, "[NATIVE-UI-NOTIFY-RECAP-06] \(actor.alias) and \(sum) points are on one row")
            rows.append(alias.frame)
        }
        XCTAssertLessThan(rows[0].minY, rows[1].minY, "[NATIVE-UI-NOTIFY-RECAP-07] the higher total comes first")
        XCTAssertEqual(host.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", Actor.sage.alias)).count, 0, "[NATIVE-UI-NOTIFY-RECAP-08] a member with no points this week has no row")
        try assertNoProviderRegistration("NATIVE-UI-NOTIFY-RECAP-09")
    }

    // MARK: N3: sign-out and another person on the same phone

    func testSigningOutClosesAnOpenedNotificationAndALateArrivalShowsTheNextPersonNothing() throws {
        try signIn(.finn)
        try allowAlerts(for: .finn)
        try revealedBet("bet-a")
        try open(try deliver(["actor": "finn", "kind": "reveal", "bet": "bet-a", "remember": "reveal"], "NATIVE-UI-NOTIFY-SWITCH-01"), "NATIVE-UI-NOTIFY-SWITCH-01")
        assertText(run.secretQuestion, in: host, "NATIVE-UI-NOTIFY-SWITCH-02")

        // Finn signs out and Oli, who is not in G1, signs in on the same phone. What Finn had opened is gone.
        try signIn(.oli)
        XCTAssertTrue(try appSessions(.finn).allSatisfy { $0["revoked"] as? Bool == true }, "[NATIVE-UI-NOTIFY-SWITCH-03] Finn's sign-in is revoked")
        assertLabel(try bring(element("notifications.status", in: host), "the notifications status", "NATIVE-UI-NOTIFY-SWITCH-04"), Self.allowed, "NATIVE-UI-NOTIFY-SWITCH-04")
        try bring(element("notifications.enable", in: host), "the notifications switch", "NATIVE-UI-NOTIFY-SWITCH-04")
        XCTAssertFalse(closeButton.exists || element("notifications.destination", in: host).exists, "[NATIVE-UI-NOTIFY-SWITCH-04] the notification Finn opened is not kept for the next person")
        XCTAssertFalse(text(run.secretQuestion, in: host).exists, "[NATIVE-UI-NOTIFY-SWITCH-04]")

        // A notification addressed to Finn that arrives late is opened by Oli: the server refuses it and nothing is shown.
        let refusedBefore = try appCalls("v0Bets:get", outcome: "NOT_AVAILABLE")
        let readBefore = try appCalls("v0Bets:get")
        try open(try deliver(["replay": "reveal"], "NATIVE-UI-NOTIFY-SWITCH-05"), "NATIVE-UI-NOTIFY-SWITCH-05")
        assertText(Self.notAvailable, in: host, "NATIVE-UI-NOTIFY-SWITCH-06")
        XCTAssertGreaterThan(try appCalls("v0Bets:get", outcome: "NOT_AVAILABLE"), refusedBefore, "[NATIVE-UI-NOTIFY-SWITCH-07] the server refused the bet for Oli")
        XCTAssertEqual(try appCalls("v0Bets:get"), readBefore, "[NATIVE-UI-NOTIFY-SWITCH-07] no bet was read for Oli")
        assertNoPrivateText(in: host, "NATIVE-UI-NOTIFY-SWITCH-08")
        try assertNoProviderRegistration("NATIVE-UI-NOTIFY-SWITCH-09")
    }
}
