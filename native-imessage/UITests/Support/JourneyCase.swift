import XCTest

/// Shared setup for the journey tests. Each test starts from a freshly reset loopback backend with the four fixture
/// people, signs in through the real phone-code screen, and drives the real extension inside the simulator's built-in
/// synthetic Messages conversation. Nothing here launches against an account: the run's simulator has none.
class JourneyCase: XCTestCase {
    enum Actor: String {
        case cora, finn, sage, oli
        var phone: String {
            switch self {
            case .cora: return "+12025550104"
            case .finn: return "+12025550101"
            case .sage: return "+12025550103"
            case .oli: return "+12025550102"
            }
        }
        var alias: String { "QA " + rawValue.capitalized }
    }

    struct Blocked: Error {}

    /// The simulator's two built-in synthetic conversations. They exist on every fresh simulator and reach nobody.
    static let conversations = ["+1 (888) 555-1212", "+1 (555) 564-8583"]

    /// Multiplies every wait in these helpers. 1 on the reference Mac; the harness raises it for a slower machine
    /// (--wait-scale). It never changes a product latency budget: those go through `budget`.
    static let pace: Double = min(8, max(1, Double(ProcessInfo.processInfo.environment["CALLED_IT_QA_WAIT_SCALE"] ?? "") ?? 1))
    /// True only when the harness declared the machine as reference hardware (--reference-hardware).
    static let referenceHardware = ProcessInfo.processInfo.environment["CALLED_IT_QA_REFERENCE_HARDWARE"] == "1"

    private(set) var run: NativeQARun!
    private(set) var control: QAControl!
    private(set) var host: XCUIApplication!
    private(set) var messages: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        run = try NativeQARun()
        guard run.manifest.fixtureSetID == "synthetic-v0-native-journeys" else {
            XCTFail("[NATIVE-UI-FIXTURE] BLOCKED: these tests need the native-sim harness fixture set")
            throw Blocked()
        }
        control = try QAControl()
        QAControl.currentTest = name
        try control.reset()
        host = XCUIApplication(bundleIdentifier: NativeQARun.hostBundle)
        messages = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
        messages.terminate()
        host.terminate()
    }

    /// On failure, keep what was on screen and what the app asked the backend, so a red test can be read from the log.
    override func tearDownWithError() throws {
        guard (testRun?.failureCount ?? 0) > 0, let control, let messages else { return }
        let picture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        picture.name = "journey-failure"
        picture.lifetime = .keepAlways
        add(picture)
        let logged = (try? control.calls()) ?? []
        let first = logged.first?["at"] as? Double ?? 0
        let calls: [String] = logged.map { call in
            let seconds = Int(((call["at"] as? Double ?? first) - first) / 1000)
            var line = "\(call["path"] ?? "?")=\(call["outcome"] ?? "?")@\(seconds)s/\(call["caller"] ?? "?")"
            if let error = call["error"] as? String { line += " [\(call["status"] ?? "?") \(error)]" }
            return line
        }
        print("JOURNEY-DIAGNOSTIC calls: " + calls.joined(separator: " "))
        if messages.state == .runningForeground, let content = try? visibleContent(of: messages) { print("JOURNEY-DIAGNOSTIC screen:\n" + content + "\nJOURNEY-DIAGNOSTIC end") }
    }

    // MARK: Evidence

    /// A product latency budget. The time is always written to the run's evidence; it fails the test only on declared
    /// reference hardware, so a slow machine can neither pass it by luck nor fail it for being slow.
    func budget(_ code: String, _ what: String, seconds: Double, limit: Double, file: StaticString = #filePath, line: UInt = #line) throws {
        let mode = Self.referenceHardware ? "enforced" : "measured only"
        try control.note(test: name, kind: "latency", detail: "\(code) \(what): \(String(format: "%.1f", seconds)) s against a budget of \(String(format: "%.0f", limit)) s, \(mode)")
        if Self.referenceHardware { XCTAssertLessThan(seconds, limit, "[\(code)] \(what)", file: file, line: line) }
    }

    /// Every retry a helper makes is written to the run's evidence, so a retried pass cannot read as a clean one.
    func recordRetry(_ kind: String, _ detail: String) throws {
        try control.note(test: name, kind: kind, detail: detail)
    }

    /// Types into a focused field, then checks the field holds exactly that text; under load the simulator drops
    /// keystrokes. A short or wrong value is cleared, the field is checked to be empty, and the text is typed again, at
    /// most three more times, each one recorded.
    /// The detail names character counts only, never the text.
    func enter(_ value: String, into field: XCUIElement, called name: String, file: StaticString = #filePath, line: UInt = #line) throws {
        // Typing into a field that has not taken the keyboard fails outright. A tap that did not give the field the keyboard
        // is repeated, at most twice, each one recorded; a field that still has not taken it fails here by name.
        let focused = { (field.value(forKey: "hasKeyboardFocus") as? Bool) ?? false }
        func takesFocus() -> Bool {
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in focused() }, object: nil)], timeout: 5 * Self.pace) == .completed
        }
        for again in 0...2 where !takesFocus() {
            guard again < 2 else {
                XCTFail("[NATIVE-UI-TYPE] \(name) did not take the keyboard after it was tapped three times", file: file, line: line)
                throw Blocked()
            }
            try recordRetry("retap", "\(name) had not taken the keyboard \(Int(5 * Self.pace)) s after tap \(again + 1)")
            if field.isHittable { field.tap() }
        }
        for attempt in 1...4 {
            // A slow machine can show the right text late; that is a wait, not a retry.
            if attempt > 1, field.value as? String == value { return }
            if attempt > 1 {
                let held = field.value as? String ?? ""
                let current = held == field.placeholderValue ? "" : held
                try recordRetry("retype", "\(name) held \(current.count) of \(value.count) characters on attempt \(attempt - 1)")
                // Typing again into a field that still holds something only adds to it.
                guard emptied(field) else {
                    XCTFail("[NATIVE-UI-TYPE] \(name) could not be emptied before typing again", file: file, line: line)
                    throw Blocked()
                }
            }
            field.typeText(value)
            let holds = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: field)
            if XCTWaiter.wait(for: [holds], timeout: 10 * Self.pace) == .completed { return }
        }
        XCTFail("[NATIVE-UI-TYPE] \(name) never held the typed text", file: file, line: line)
        throw Blocked()
    }

    /// Empties a focused field, as a person would with the delete key, and requires it to be empty.
    func clear(_ field: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(emptied(field), "[NATIVE-UI-TYPE] the field could not be emptied", file: file, line: line)
    }

    /// Deletes what a focused field holds and reports whether it ended up empty. Keystrokes still arriving, or delete
    /// keys the simulator dropped, can leave text behind, so it reads the field again and deletes what is left, at most
    /// three times. From the second time it first puts the cursor at the end, since delete only removes what is before it.
    private func emptied(_ field: XCUIElement) -> Bool {
        func held() -> String {
            let now = field.value as? String ?? ""
            return now == field.placeholderValue ? "" : now
        }
        for round in 1...3 {
            // Let late keystrokes land before counting what there is to delete: the field has settled once its value stops
            // changing for a moment. The wait is on the field itself, never a block that reads it: a read still under way
            // when a waiter's time ends is reported by XCTest as a failure of the test ("Interrupted by waiter").
            for _ in 0..<5 {
                let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value != %@", field.value as? String ?? ""), object: field)
                if XCTWaiter.wait(for: [changed], timeout: Self.pace) != .completed { break }
            }
            let current = held()
            if current.isEmpty { return true }
            if round > 1, field.isHittable { field.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap() }
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
            let empty = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '' OR value == %@", field.placeholderValue ?? ""), object: field)
            if XCTWaiter.wait(for: [empty], timeout: 5 * Self.pace) == .completed { return true }
        }
        return held().isEmpty
    }

    /// The fixture rows of app sign-ins for one person, leaving out the harness's control sessions.
    func appSessions(_ actor: Actor) throws -> [[String: Any]] {
        try control.rows("sessions").filter { $0["actor"] as? String == actor.rawValue && $0["control"] as? Bool != true }
    }

    // MARK: Fixture lookups

    func groupID(_ key: String) throws -> String {
        guard let id = (try control.inspect()["groups"] as? [String: String])?[key] else { XCTFail("[NATIVE-UI-FIXTURE] unknown group \(key)"); throw Blocked() }
        return id
    }

    func accountID(_ actor: Actor) throws -> String {
        guard let id = (try control.inspect()["accounts"] as? [String: String])?[actor.rawValue] else { XCTFail("[NATIVE-UI-FIXTURE] unknown actor \(actor)"); throw Blocked() }
        return id
    }

    func bet(_ key: String) throws -> [String: Any] {
        guard let row = try control.rows("bets").first(where: { $0["key"] as? String == key }) else { XCTFail("[NATIVE-UI-FIXTURE] unknown bet \(key)"); throw Blocked() }
        return row
    }

    func betID(_ key: String) throws -> String { try bet(key)["id"] as? String ?? "" }

    func appCalls(_ path: String, outcome: String = "success") throws -> Int {
        try control.calls().filter { $0["path"] as? String == path && $0["outcome"] as? String == outcome }.count
    }

    // MARK: Elements

    func element(_ id: String, in container: XCUIElement) -> XCUIElement {
        container.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    @discardableResult
    func required(_ id: String, in container: XCUIElement, timeout: TimeInterval = 20, _ code: String = "NATIVE-UI-ID", file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        let target = element(id, in: container)
        guard target.waitForExistence(timeout: timeout * Self.pace) else {
            XCTFail("[\(code)] required element \(id) did not appear", file: file, line: line)
            throw Blocked()
        }
        return target
    }

    /// A control without an identifier, found by its exact visible label.
    func labelled(_ label: String, _ type: XCUIElement.ElementType = .button, in container: XCUIElement, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        let target = container.descendants(matching: type).matching(NSPredicate(format: "label == %@", label)).firstMatch
        guard target.waitForExistence(timeout: timeout * Self.pace) else {
            XCTFail("[NATIVE-UI-LABEL] required \(label) did not appear", file: file, line: line)
            throw Blocked()
        }
        return target
    }

    /// Whether a control with this exact label is on screen right now; for asserting that something is absent.
    func labelled(_ label: String, in container: XCUIElement, timeout: TimeInterval, quiet: Bool) -> Bool {
        container.descendants(matching: .button).matching(NSPredicate(format: "label == %@", label)).firstMatch.waitForExistence(timeout: timeout)
    }

    func tap(_ target: XCUIElement, scrolling container: XCUIElement? = nil, file: StaticString = #filePath, line: UInt = #line) throws {
        let surface: XCUIElement = container ?? messages
        let app: XCUIApplication = (container as? XCUIApplication) ?? messages
        let keyboard = app.keyboards.firstMatch
        // The app puts a Done button on top of its keyboards. It is the sure sign that a keyboard is up, also where the
        // keyboard itself is not reported to the test, and the sure way to put it away, also for a multi-line field.
        let done = app.buttons.matching(NSPredicate(format: "identifier IN %@", ["keyboard.done", "auth.keyboardDone"])).firstMatch
        let typing = [.textField, .secureTextField, .textView].contains(target.elementType)
        let keyboardUp = { keyboard.exists || done.exists }
        func holds(_ limit: TimeInterval, _ condition: @escaping () -> Bool) -> Bool {
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)], timeout: limit) == .completed
        }
        // A tap that lands while the page is still moving only stops the scroll, so this waits until the target stays put.
        func settle(_ limit: TimeInterval) {
            var last = CGRect.null
            _ = holds(limit) {
                let now = target.frame
                defer { last = now }
                return now == last
            }
        }
        // A control that can be tapped where it is gets tapped where it is. One under or behind the keyboard or its Done bar
        // needs the keyboard gone first. That holds for a field too: XCTest reports a covered field as tappable, and a tap
        // at its centre would land on the bar or the keyboard.
        if keyboardUp() {
            let top = done.exists ? done.frame.minY : keyboard.frame.minY
            if !target.isHittable || target.frame.maxY > top {
                if done.exists, done.isHittable { done.tap() }
                if !holds(10 * Self.pace, { !keyboardUp() }) {
                    // Without a Done button, the way a person puts the keyboard away: drag the content down into it.
                    surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).press(forDuration: 0.1, thenDragTo: surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)))
                    _ = holds(10 * Self.pace) { !keyboardUp() }
                }
                settle(5 * Self.pace)
            }
        }
        if !target.isHittable {
            // Scroll toward the target one swipe at a time, and look again only once the page has come to rest. A control
            // that is already on screen is not scrolled away: it first gets a moment to become tappable. "On screen" is
            // the part of the surface the screen shows; a scrolling surface's own frame is its whole content, so a control
            // far below the bottom edge lies inside it.
            for _ in 0..<6 where !target.isHittable {
                let frame = target.frame
                let shown = surface.frame.intersection(app.frame)
                if !frame.isEmpty, shown.contains(CGPoint(x: frame.midX, y: frame.midY)), holds(3 * Self.pace, { target.isHittable }) { break }
                if frame.midY > surface.frame.midY { surface.swipeUp() } else { surface.swipeDown() }
                settle(5 * Self.pace)
            }
            _ = holds(15 * Self.pace) { target.isHittable }
            settle(10 * Self.pace)
        }
        if !target.isEnabled || !target.isHittable {
            // On a slow machine a control can exist before it can be used.
            // A block predicate is asked directly; a format predicate makes XCTest capture a full element description on every poll.
            _ = holds(30 * Self.pace) { target.isHittable && target.isEnabled }
        }
        guard target.isEnabled, target.isHittable else {
            XCTFail("[NATIVE-UI-ACTION] \(target) must be enabled and on screen", file: file, line: line)
            throw Blocked()
        }
        target.tap()
    }
    func tap(_ id: String, in container: XCUIElement, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) throws {
        try tap(required(id, in: container, timeout: timeout, file: file, line: line), scrolling: container, file: file, line: line)
    }

    func assertLabel(_ target: XCUIElement, _ value: String, _ code: String, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        let reached = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", value), object: target)], timeout: timeout * Self.pace) == .completed
        XCTAssertTrue(reached, "[\(code)] expected \"\(value)\", found \"\(target.exists ? target.label : "nothing")\"", file: file, line: line)
    }

    func assertGone(_ target: XCUIElement, _ code: String, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        let gone = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == NO"), object: target)], timeout: timeout * Self.pace) == .completed
        XCTAssertTrue(gone, "[\(code)] \(target) should not be shown", file: file, line: line)
    }

    func text(_ value: String, in container: XCUIElement) -> XCUIElement {
        container.staticTexts.matching(NSPredicate(format: "label == %@", value)).firstMatch
    }

    func assertText(_ value: String, in container: XCUIElement, _ code: String, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(text(value, in: container).waitForExistence(timeout: timeout * Self.pace), "[\(code)] expected the text \"\(value)\"", file: file, line: line)
    }

    /// Every label, identifier and value in one snapshot of the app's accessibility tree, to prove a private string is
    /// nowhere on screen.
    func visibleContent(of app: XCUIApplication) throws -> String {
        var lines: [String] = []
        func walk(_ node: XCUIElementSnapshot) {
            let parts = [node.label, node.identifier, node.value as? String ?? "", node.placeholderValue ?? ""].filter { !$0.isEmpty }
            if !parts.isEmpty { lines.append(parts.joined(separator: " | ")) }
            node.children.forEach(walk)
        }
        walk(try app.snapshot())
        return lines.joined(separator: "\n")
    }

    func assertNoPrivateContent(in app: XCUIApplication, extra: [String] = [], anchor: String = "navigation.settings", _ code: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let content = try visibleContent(of: app)
        XCTAssertTrue(content.contains(anchor), "[\(code)] the extension must be on screen for this check to mean anything", file: file, line: line)
        for sentinel in run.privateSentinels + extra {
            XCTAssertFalse(content.contains(sentinel), "[\(code)] private content \(sentinel.prefix(18))… reached the screen", file: file, line: line)
        }
    }

    /// The same check by direct query, for screens where a whole-app snapshot does not include the extension
    /// (seen after a system dialog and in the compact view). The caller proves the screen is showing first.
    func assertNoPrivateText(in app: XCUIApplication, extra: [String] = [], _ code: String, file: StaticString = #filePath, line: UInt = #line) {
        for sentinel in run.privateSentinels + extra {
            let found = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", sentinel, sentinel)).count
            XCTAssertEqual(found, 0, "[\(code)] private content \(sentinel.prefix(18))… reached the screen", file: file, line: line)
        }
    }

    // MARK: Host app

    /// Launches the host app and returns its phone field. A session left by an earlier test in this run is signed
    /// out first, so the screen under test always starts signed out.
    ///
    /// The host app asks the server about a stored session as it starts, and keeps "Sign out" disabled until it has the
    /// answer. A session left by an earlier test is unknown to the backend this test reset, so the app normally signs
    /// itself out; a session the server still accepts (a second sign-in inside one test) or could not be asked about
    /// stays, with "Sign out" usable again. So this waits for whichever the app settles on, the phone field or a "Sign
    /// out" that can be used, and never for a "Sign out" that is still being checked and may be about to go away. When
    /// the session stayed, the tap is required, as before.
    func launchHostSignedOut(file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        host.launchEnvironment = run.launchEnvironment
        host.launch()
        let phone = element("auth.phone", in: host)
        let signOut = host.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ AND enabled == YES", "auth.signOut")).firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in phone.exists || signOut.exists }, object: nil)
        guard XCTWaiter.wait(for: [settled], timeout: 20 * Self.pace) == .completed else {
            XCTFail("[NATIVE-UI-AUTH] the host app showed neither sign-in nor a session it had finished checking", file: file, line: line)
            throw Blocked()
        }
        if !phone.exists {
            signOut.tap()
            _ = try required("auth.phone", in: host, timeout: 15, "NATIVE-UI-AUTH", file: file, line: line)
        }
        return phone
    }

    /// Signs in through the real phone-code screen with the fake code.
    func signIn(_ actor: Actor, file: StaticString = #filePath, line: UInt = #line) throws {
        let phone = try launchHostSignedOut(file: file, line: line)
        assertLabel(try required("qa.runtime.endpointPolicy", in: host), "loopback_only", "NATIVE-UI-RUNTIME", file: file, line: line)
        assertLabel(try required("qa.runtime.apiOrigin", in: host), run.manifest.apiOrigin, "NATIVE-UI-RUNTIME", file: file, line: line)
        assertLabel(try required("qa.runtime.networkIsolation", in: host), run.networkIsolation == "denied" ? "denied" : "observed_not_denied", "NATIVE-UI-RUNTIME", file: file, line: line)
        phone.tap()
        try enter(actor.phone, into: phone, called: "auth.phone", file: file, line: line)
        try tap("auth.requestCode", in: host, file: file, line: line)
        let code = try required("auth.code", in: host, timeout: 15, "NATIVE-UI-AUTH", file: file, line: line)
        code.tap()
        try enter("000000", into: code, called: "auth.code", file: file, line: line)
        try tap("auth.verify", in: host, file: file, line: line)
        _ = try required("auth.returnToMessages", in: host, timeout: 15, "NATIVE-UI-AUTH", file: file, line: line)
        assertLabel(try required("qa.runtime.attestationState", in: host), "attested", "NATIVE-UI-ATTESTATION", file: file, line: line)
    }

    // MARK: Messages extension

    /// Opens the real extension in one of the simulator's synthetic conversations. Messages restores whatever it showed
    /// last, so this accepts the three places it can start (first-run sheet, conversation list, a conversation) and
    /// then requires the extension itself.
    func openExtension(conversation index: Int = 0, file: StaticString = #filePath, line: UInt = #line) throws {
        let title = Self.conversations[index]
        try launchMessages(file: file, line: line)
        // System onboarding sheets a fresh simulator may show: "Shared with You" (OK) and "Apple Intelligence in Messages" (Continue).
        let firstRun = messages.buttons.matching(NSPredicate(format: "label IN %@", ["OK", "Continue"])).firstMatch
        let cell = messages.cells.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        let field = element("messageBodyField", in: messages)
        let started = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in firstRun.exists || cell.exists || field.exists }, object: nil)
        guard XCTWaiter.wait(for: [started], timeout: 30 * Self.pace) == .completed else {
            XCTFail("[NATIVE-UI-MESSAGES] Messages showed no synthetic conversation", file: file, line: line)
            throw Blocked()
        }
        // A sheet can arrive a moment after the list it covers, and one can follow another.
        while firstRun.waitForExistence(timeout: field.exists ? 0 : 4 * Self.pace) { firstRun.tap() }
        if !field.exists || element("ConversationTitle", in: messages).label != title {
            let back = element("BackButton", in: messages)
            // Messages can open on an empty "New Message" draft. The conversation list and its cells still exist underneath it
            // but cannot be tapped, so the draft is looked for first and by itself, whether or not the cell exists. It is
            // cancelled at most twice, and each cancel is written to the run's evidence.
            let heading = element("ConversationTitle", in: messages)
            let cancel = messages.buttons["Cancel"]
            let draft = { heading.exists && heading.label == "New Message" && cancel.exists }
            for _ in 0..<2 where draft() {
                try recordRetry("draft-cancel", "Messages opened on an empty New Message draft, which was cancelled")
                cancel.tap()
                _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !draft() }, object: nil)], timeout: 10 * Self.pace)
            }
            // Inside the other conversation, the back button leads to the list.
            if !cell.waitForExistence(timeout: 3 * Self.pace), back.exists { back.tap() }
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == YES AND hittable == YES"), object: cell)
            guard XCTWaiter.wait(for: [ready], timeout: 15 * Self.pace) == .completed else {
                XCTFail("[NATIVE-UI-MESSAGES] synthetic conversation \(title) is missing or cannot be tapped", file: file, line: line)
                throw Blocked()
            }
            cell.tap()
            // Under load Messages can swallow the tap and stay on the list. One more tap is allowed, and recorded.
            let opened = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in field.exists }, object: nil)
            if XCTWaiter.wait(for: [opened], timeout: 15 * Self.pace) != .completed, cell.exists, cell.isHittable {
                try recordRetry("retap", "Messages stayed on the conversation list after the first tap on a conversation")
                cell.tap()
            }
        }
        assertLabel(try required("ConversationTitle", in: messages, timeout: 30, file: file, line: line), title, "NATIVE-UI-MESSAGES", file: file, line: line)
        if !element("navigation.settings", in: messages).waitForExistence(timeout: 2 * Self.pace) {
            try tap(labelled("add", in: messages, file: file, line: line), file: file, line: line)
            try tap(labelled("Called It", .cell, in: messages, file: file, line: line), file: file, line: line)
        }
        _ = try required("navigation.settings", in: messages, timeout: 30, "NATIVE-UI-EXTENSION", file: file, line: line)
    }

    /// Messages can time out on launch when the machine is overloaded. It gets a bounded wait and exactly one relaunch,
    /// and the relaunch is written to the run's evidence.
    private func launchMessages(file: StaticString, line: UInt) throws {
        let tolerated = XCTExpectedFailure.Options()
        tolerated.isStrict = false
        for attempt in 1...2 {
            XCTExpectFailure("Messages may time out on launch under load; one recorded relaunch is allowed", options: tolerated) { messages.launch() }
            if messages.wait(for: .runningForeground, timeout: 60 * Self.pace) { return }
            if attempt == 1 {
                try recordRetry("relaunch", "Messages did not reach the foreground on the first launch")
                messages.terminate()
            }
        }
        XCTFail("[NATIVE-UI-MESSAGES] Messages did not start, also after one relaunch", file: file, line: line)
        throw Blocked()
    }

    /// Links the open conversation to a fixture group through the real linking screen and lands on the group's home.
    func link(_ group: String, file: StaticString = #filePath, line: UInt = #line) throws {
        try tap(labelled("Link this conversation", in: messages, timeout: 20, file: file, line: line), file: file, line: line)
        try tap("group.link." + groupID(group), in: messages, file: file, line: line)
        _ = try required("navigation.board", in: messages, timeout: 15, "NATIVE-UI-LINK", file: file, line: line)
        assertLabel(try required("qa.runtime.bundleID", in: messages), NativeQARun.extensionBundle, "NATIVE-UI-RUNTIME", file: file, line: line)
        assertLabel(try required("qa.runtime.attestationState", in: messages), "attested", "NATIVE-UI-ATTESTATION", file: file, line: line)
    }

    /// Sign in, open the extension, link the conversation: the common start of a journey.
    func start(as actor: Actor, in group: String = "G1", conversation: Int = 0, file: StaticString = #filePath, line: UInt = #line) throws {
        try signIn(actor, file: file, line: line)
        try openExtension(conversation: conversation, file: file, line: line)
        try link(group, file: file, line: line)
    }

    /// Opens a fixture bet from the group's list and returns the bet screen.
    @discardableResult
    func openBet(_ key: String, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        try tap("group.bet." + betID(key), in: messages, timeout: 15, file: file, line: line)
        return try required("bet.screen", in: messages, timeout: 15, "NATIVE-UI-BET", file: file, line: line)
    }

    /// Chooses a side and requires the control to show it as chosen before going on.
    func choose(option index: Int, in screen: XCUIElement, file: StaticString = #filePath, line: UInt = #line) throws {
        let option = try required("bet.option.\(index)", in: screen, file: file, line: line)
        try tap(option, file: file, line: line)
        let chosen = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == YES"), object: option)], timeout: 5) == .completed
        XCTAssertTrue(chosen, "[NATIVE-UI-CHOICE] option \(index) did not become the chosen side", file: file, line: line)
    }

    /// Types into a text field of the extension after bringing it on screen.
    func type(_ value: String, into id: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let field = try required(id, in: messages, file: file, line: line)
        try tap(field, scrolling: messages, file: file, line: line)
        try enter(value, into: field, called: id, file: file, line: line)
    }

    /// Opens a menu picker and chooses one entry by its visible name.
    func chooseMenu(_ id: String, _ entry: String, file: StaticString = #filePath, line: UInt = #line) throws {
        try tap(id, in: messages, file: file, line: line)
        try tap(labelled(entry, in: messages, file: file, line: line), file: file, line: line)
    }

    /// Waits until the server shows what the tap should have caused.
    func eventually(_ code: String, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line, _ condition: @escaping () throws -> Bool) {
        let reached = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in (try? condition()) ?? false }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [reached], timeout: timeout * Self.pace), .completed, "[\(code)] the server never showed the expected state", file: file, line: line)
    }

    /// Conversation links made by the app, leaving out the harness's own control sessions.
    func appLinks() throws -> [[String: Any]] {
        try control.rows("links").filter { $0["control"] as? Bool != true }
    }

    func goHome(file: StaticString = #filePath, line: UInt = #line) throws {
        try tap(labelled("Home", in: messages, file: file, line: line), file: file, line: line)
        _ = try required("navigation.board", in: messages, timeout: 15, file: file, line: line)
    }
}
