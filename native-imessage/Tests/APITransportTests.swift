import XCTest

final class APITransportTests: XCTestCase {
    func testForbiddenTransportCallsFailBeforeConfigurationOrNetwork() async {
        for (kind, path, args) in [
            ("query", "ext:card", [:] as [String: Any]),
            ("delete", "v0Bets:get", [:] as [String: Any]),
            ("query", "v0Bets:get", ["now": 0] as [String: Any])
        ] {
            do {
                let _: Ignored? = try await API.run(kind, path, args)
                XCTFail("[NATIVE-TRANSPORT-01] invalid request must fail before configuration/network")
            } catch let error as APIError {
                XCTAssertEqual(error.code, "NOT_AVAILABLE", "[NATIVE-TRANSPORT-02]")
            } catch {
                XCTFail("[NATIVE-TRANSPORT-03] wrong rejection layer; no bundle configuration or network should be touched")
            }
        }
    }
}
