import XCTest

/// A failed load must never leave an empty screen: the app tries again by itself a bounded number of times, and when that
/// is not enough it says so and offers "Try again". The failures here are injected at the harness gateway.
final class ResilienceJourneyTests: JourneyCase {
    private let failure = "Couldn't complete this request. Check your connection and try again."

    private func outcomes(_ path: String) throws -> [String] {
        try control.calls().filter { $0["path"] as? String == path && $0["caller"] as? String == "CalledItExtension" }.compactMap { $0["outcome"] as? String }
    }

    func testOneFailedFirstLoadRecoversWithoutThePersonDoingAnything() throws {
        try control.seedBet("bet-a", format: "this_that")
        // The host app asks v0Auth:me too, about a session an earlier test left, before the extension is opened.
        try control.failNext("v0Auth:me", count: 1, caller: "CalledItExtension")
        try start(as: .finn)
        _ = try required("group.bet." + betID("bet-a"), in: messages, "NATIVE-UI-RECOVER-01")
        // The loopback backend can itself fail a call under load, with no code, and the app repeats that too. Such a failure
        // is in the run's evidence as a failed app call; here it may sit between the injected failure and the success,
        // within the app's two quiet repeats.
        let loads = try outcomes("v0Auth:me")
        let recovered = Array(loads.prefix((loads.firstIndex(of: "success") ?? loads.count - 1) + 1))
        XCTAssertEqual(recovered.first, "injected", "[NATIVE-UI-RECOVER-02] the first load failed: \(loads)")
        XCTAssertEqual(recovered.last, "success", "[NATIVE-UI-RECOVER-02] the load was repeated until it succeeded: \(loads)")
        XCTAssertTrue(recovered.count <= 3 && recovered.dropFirst().dropLast().allSatisfy { $0 == "UNKNOWN" }, "[NATIVE-UI-RECOVER-02] nothing but failed attempts came before the success, within two repeats: \(loads)")
        XCTAssertFalse(element("load.retry", in: messages).exists, "[NATIVE-UI-RECOVER-03] nothing asks the person to try again")
        XCTAssertFalse(text(failure, in: messages).exists, "[NATIVE-UI-RECOVER-03] no error is left on screen")
    }

    func testAFirstLoadThatKeepsFailingSaysSoAndOffersTryAgain() throws {
        try signIn(.finn)
        try control.failNext("v0Auth:me", count: 3)
        try openExtension()
        let retry = try required("load.retry", in: messages, timeout: 40, "NATIVE-UI-RETRY-01")
        assertText(failure, in: messages, "NATIVE-UI-RETRY-02")
        XCTAssertEqual(retry.label, "Try again", "[NATIVE-UI-RETRY-02] the retry action has a readable name")
        XCTAssertEqual(try outcomes("v0Auth:me"), ["injected", "injected", "injected"], "[NATIVE-UI-RETRY-03] three attempts, then the app stops by itself")
        XCTAssertFalse(element("navigation.board", in: messages).exists, "[NATIVE-UI-RETRY-04] no group is shown from a failed load")

        try tap(retry, scrolling: messages)
        assertGone(element("load.retry", in: messages), "NATIVE-UI-RETRY-05")
        XCTAssertFalse(text(failure, in: messages).exists, "[NATIVE-UI-RETRY-05] the error is cleared by a successful retry")
        try link("G1")
        _ = try required("navigation.board", in: messages, "NATIVE-UI-RETRY-06")
        XCTAssertEqual(try outcomes("v0Auth:me").prefix(4).last, "success", "[NATIVE-UI-RETRY-06] the retry reached the server")
    }

    func testAListThatFailsToLoadSaysSoAndLoadsOnTryAgain() throws {
        try control.seedBet("bet-a", format: "this_that")
        try control.failNext("v0Bets:list", count: 3)
        try start(as: .finn)
        let retry = try required("load.retry", in: messages, timeout: 40, "NATIVE-UI-LIST-01")
        assertText(failure, in: messages, "NATIVE-UI-LIST-02")
        XCTAssertFalse(element("group.bet." + (try betID("bet-a")), in: messages).exists, "[NATIVE-UI-LIST-03] no bet is listed from a failed load")
        XCTAssertFalse(text("No available bets since you joined. Earlier cards stay unavailable, including after rejoining.", in: messages).exists, "[NATIVE-UI-LIST-03] a failed load is not shown as an empty list")

        try tap(retry, scrolling: messages)
        _ = try required("group.bet." + betID("bet-a"), in: messages, "NATIVE-UI-LIST-04")
        assertGone(element("load.retry", in: messages), "NATIVE-UI-LIST-05")
    }
}
