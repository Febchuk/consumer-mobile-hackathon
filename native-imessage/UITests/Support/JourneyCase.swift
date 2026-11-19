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
        let calls = logged.map { "\($0["path"] ?? "?")=\($0["outcome"] ?? "?")@\(Int((($0["at"] as? Double ?? first) - first) / 1000))s/\($0["caller"] ?? "?")" }
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
    /// keystrokes. A short or wrong value is cleared and typed again, at most three more times, each one recorded.
    /// The detail names character counts only, never the text.
    func enter(_ value: String, into field: XCUIElement, called name: String, file: StaticString = #filePath, line: UInt = #line) throws {
        for attempt in 1...4 {
            if attempt > 1 {
                let held = field.value as? String ?? ""
                let current = held == field.placeholderValue ? "" : held
                try recordRetry("retype", "\(name) held \(current.count) of \(value.count) characters on attempt \(attempt - 1)")
                if !current.isEmpty { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count)) }
            }
            field.typeText(value)
            let holds = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: field)
            if XCTWaiter.wait(for: [holds], timeout: 5 * Self.pace) == .completed { return }
        }
        XCTFail("[NATIVE-UI-TYPE] \(name) never held the typed text", file: file, line: line)
        throw Blocked()
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
    func required(_ id: String, in container: XCUIElement, timeout: TimeInterval = 10, _ code: String = "NATIVE-UI-ID", file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        let target = element(id, in: container)
        guard target.waitForExistence(timeout: timeout * Self.pace) else {
            XCTFail("[\(code)] required element \(id) did not appear", file: file, line: line)
            throw Blocked()
        }
        return target
    }

    /// A control without an identifier, found by its exact visible label.
    func labelled(_ label: String, _ type: XCUIElement.ElementType = .button, in container: XCUIElement, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        let target = container.descendants(matching: type).matching(NSPredicate(format: "label == %@", label)).firstMatch
        guard target.waitForExistence(timeout: timeout * Self.pace) else {
            XCTFail("[NATIVE-UI-LABEL] required \(label) did not appear", file: file, line: line)
            throw Blocked()
        }
        return target
    }

    func tap(_ target: XCUIElement, scrolling container: XCUIElement? = nil, file: StaticString = #filePath, line: UInt = #line) throws {
        let keyboard = messages.keyboards.firstMatch
        let typing = [.textField, .secureTextField, .textView].contains(target.elementType)
        if keyboard.exists, !typing, !target.isHittable || target.frame.maxY > keyboard.frame.minY {
            // The way a person puts the keyboard away here: drag the content down into it.
            let surface: XCUIElement = container ?? messages
            surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).press(forDuration: 0.1, thenDragTo: surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)))
            _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == NO"), object: keyboard)], timeout: 5 * Self.pace)
        }
        if !target.isHittable {
            (container ?? messages).swipeUp()
            _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == YES"), object: target)], timeout: 5 * Self.pace)
            // A tap that lands while the list is still coasting only stops the scroll, so wait until the target is at rest.
            var last = CGRect.null
            let atRest = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                let now = target.frame
                defer { last = now }
                return now == last
            }, object: nil)
            _ = XCTWaiter.wait(for: [atRest], timeout: 6 * Self.pace)
        } else if !target.isEnabled {
            // On a slow machine a control can exist before it can be used.
            _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == YES AND enabled == YES"), object: target)], timeout: 5 * Self.pace)
        }
        guard target.isEnabled, target.isHittable else {
            XCTFail("[NATIVE-UI-ACTION] \(target) must be enabled and on screen", file: file, line: line)
            throw Blocked()
        }
        target.tap()
    }

    func tap(_ id: String, in container: XCUIElement, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) throws {
        try tap(required(id, in: container, timeout: timeout, file: file, line: line), scrolling: container, file: file, line: line)
    }

    func assertLabel(_ target: XCUIElement, _ value: String, _ code: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        let reached = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", value), object: target)], timeout: timeout * Self.pace) == .completed
        XCTAssertTrue(reached, "[\(code)] expected \"\(value)\", found \"\(target.exists ? target.label : "nothing")\"", file: file, line: line)
    }

    func assertGone(_ target: XCUIElement, _ code: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        let gone = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == NO"), object: target)], timeout: timeout * Self.pace) == .completed
        XCTAssertTrue(gone, "[\(code)] \(target) should not be shown", file: file, line: line)
    }

    func text(_ value: String, in container: XCUIElement) -> XCUIElement {
        container.staticTexts.matching(NSPredicate(format: "label == %@", value)).firstMatch
    }

    func assertText(_ value: String, in container: XCUIElement, _ code: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
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

    /// Signs in through the real phone-code screen with the fake code. A session left by an earlier test in this run
    /// is signed out first, so the screen under test always starts signed out.
    func signIn(_ actor: Actor, file: StaticString = #filePath, line: UInt = #line) throws {
        host.launchEnvironment = run.launchEnvironment
        host.launch()
        let phone = element("auth.phone", in: host)
        let signOut = element("auth.signOut", in: host)
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in phone.exists || signOut.exists }, object: nil)
        guard XCTWaiter.wait(for: [settled], timeout: 20 * Self.pace) == .completed else {
            XCTFail("[NATIVE-UI-AUTH] the host app showed neither sign-in nor a session", file: file, line: line)
            throw Blocked()
        }
        if signOut.exists {
            signOut.tap()
            _ = try required("auth.phone", in: host, timeout: 15, "NATIVE-UI-AUTH", file: file, line: line)
        }
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
            if !cell.waitForExistence(timeout: 3 * Self.pace), back.exists { back.tap() }
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == YES AND hittable == YES"), object: cell)
            guard XCTWaiter.wait(for: [ready], timeout: 15 * Self.pace) == .completed else {
                XCTFail("[NATIVE-UI-MESSAGES] synthetic conversation \(title) is missing or cannot be tapped", file: file, line: line)
                throw Blocked()
            }
            cell.tap()
        }
        assertLabel(try required("ConversationTitle", in: messages, file: file, line: line), title, "NATIVE-UI-MESSAGES", file: file, line: line)
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
