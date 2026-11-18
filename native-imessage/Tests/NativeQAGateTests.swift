import CryptoKit
import XCTest

final class NativeQAGateTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_795_000_000)
    private let runID = "11111111-2222-4333-8444-555555555555"
    private let simulator = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"

    private var manifest: [String: Any] {
        ["version": 1, "runID": runID, "simulatorUDID": simulator,
         "nativeSourceRevision": String(repeating: "a", count: 40), "backendSourceRevision": String(repeating: "b", count: 40),
         "deploymentID": "qa-" + runID, "configVersion": "qa-unit", "fixtureSetID": "synthetic-v0-unit",
         "apiOrigin": "http://127.0.0.1:43127", "cardOrigin": "http://127.0.0.1:43127",
         "issuedAt": now.timeIntervalSince1970 * 1000 - 1_000, "expiresAt": now.timeIntervalSince1970 * 1000 + 60_000,
         "erasedSimulator": true, "syntheticDataOnly": true, "outboundNetworkDenied": true]
    }

    private func environment(_ object: [String: Any]) throws -> [String: String] {
        ["CALLED_IT_QA_RUN_ID": runID,
         "CALLED_IT_QA_MANIFEST_BASE64": try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]).base64EncodedString(),
         "SIMULATOR_UDID": simulator]
    }

    func testRunnerGatePinsRawManifestBytesAndUsesOnlyApprovedActivationVariables() throws {
        var environment = try self.environment(manifest)
        let original = try NativeQARun(environment: environment, now: now)
        let hash = SHA256.hash(data: original.rawManifest).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(original.manifestSHA256, hash, "[NATIVE-QA-01]")
        XCTAssertEqual(Set(original.launchEnvironment.keys), Set(["CALLED_IT_QA_RUN_ID", "CALLED_IT_QA_MANIFEST_BASE64"]), "[NATIVE-QA-02] no phone, OTP, token or separate endpoint override")
        environment["CALLED_IT_QA_MANIFEST_BASE64"] = (original.rawManifest + Data("\n".utf8)).base64EncodedString()
        let spaced = try NativeQARun(environment: environment, now: now)
        XCTAssertNotEqual(spaced.manifestSHA256, original.manifestSHA256, "[NATIVE-QA-03] hash raw bytes, not re-encoded JSON")
    }

    func testRunnerGateRejectsMissingUnknownAndUnsafeManifestFields() throws {
        for key in manifest.keys {
            var payload = manifest
            payload.removeValue(forKey: key)
            XCTAssertThrowsError(try NativeQARun(environment: self.environment(payload), now: now), "[NATIVE-QA-04] missing manifest field")
        }
        var payload = manifest
        payload["token"] = "SYNTHETIC_FORBIDDEN_TOKEN"
        XCTAssertThrowsError(try NativeQARun(environment: self.environment(payload), now: now), "[NATIVE-QA-05] no private activation data")
        for key in ["erasedSimulator", "syntheticDataOnly", "outboundNetworkDenied"] {
            payload = manifest
            payload[key] = false
            XCTAssertThrowsError(try NativeQARun(environment: self.environment(payload), now: now), "[NATIVE-QA-06] external isolation evidence still required")
        }
        for origin in ["https://127.0.0.1:43127", "http://localhost:43127", "http://127.0.0.1:80", "http://foreign.invalid:43127", "http://127.0.0.1:43127/path", "http://127.0.0.1:43127?secret=x"] {
            payload = manifest
            payload["apiOrigin"] = origin
            XCTAssertThrowsError(try NativeQARun(environment: self.environment(payload), now: now), "[NATIVE-QA-07] numeric loopback only")
        }
    }

    private var observed: [String: Any] {
        var payload = manifest
        payload["outboundNetworkDenied"] = false
        payload["outboundNetworkObserved"] = true
        return payload
    }

    func testObservedNetworkModeIsNamedAndNeverReadAsDenied() throws {
        XCTAssertEqual(try NativeQARun(environment: self.environment(manifest), now: now).networkIsolation, "denied", "[NATIVE-QA-13]")
        XCTAssertEqual(try NativeQARun(environment: self.environment(observed), now: now).networkIsolation, "observed", "[NATIVE-QA-14]")
        XCTAssertEqual(QANetworkIsolation.resolve(manifest: observed, buildChannel: "qa", isSimulator: true), .observed, "[NATIVE-QA-14]")
        XCTAssertEqual(QANetworkIsolation.observed.diagnostic, "observed_not_denied", "[NATIVE-QA-14]")
        var payload = observed
        payload["outboundNetworkDenied"] = true
        XCTAssertNil(QANetworkIsolation.resolve(manifest: payload, buildChannel: "qa", isSimulator: true), "[NATIVE-QA-15] a manifest cannot claim both")
        XCTAssertThrowsError(try NativeQARun(environment: self.environment(payload), now: now), "[NATIVE-QA-15]")
        payload = observed
        payload["outboundNetworkObserved"] = false
        XCTAssertNil(QANetworkIsolation.resolve(manifest: payload, buildChannel: "qa", isSimulator: true), "[NATIVE-QA-16] neither denied nor observed")
        XCTAssertThrowsError(try NativeQARun(environment: self.environment(payload), now: now), "[NATIVE-QA-16]")
    }

    func testObservedNetworkModeIsImpossibleOnADeviceOrOutsideAQABuild() throws {
        XCTAssertNil(QANetworkIsolation.resolve(manifest: observed, buildChannel: "qa", isSimulator: false), "[NATIVE-QA-17] never on a device")
        for channel in ["release", "testflight", "debug", "", nil] as [String?] {
            XCTAssertNil(QANetworkIsolation.resolve(manifest: observed, buildChannel: channel, isSimulator: true), "[NATIVE-QA-18] never outside a QA build")
        }
        var release = try qaBuildValues()
        release["CalledItBuildChannel"] = "release"
        let data = try JSONSerialization.data(withJSONObject: observed, options: [.sortedKeys])
        for bundle in ["com.mikunad.calledit.qa.host", "com.mikunad.calledit.messages"] {
            XCTAssertThrowsError(try QARuntimeContext.validate(manifestData: data, launchRunID: runID, bundleID: bundle, buildValues: release, simulatorUDID: simulator, at: now), "[NATIVE-QA-18]")
        }
        let accepted = try QARuntimeContext.validate(manifestData: data, launchRunID: runID, bundleID: "com.mikunad.calledit.qa.host", buildValues: try qaBuildValues(), simulatorUDID: simulator, at: now)
        XCTAssertEqual(accepted.networkIsolation, .observed, "[NATIVE-QA-19] the same manifest is accepted only by the QA simulator build")
        for origin in ["http://192.168.1.10:8199", "https://127.0.0.1:8199", "http://localhost:8199"] {
            var payload = observed
            payload["apiOrigin"] = origin
            XCTAssertNil(QANetworkIsolation.resolve(manifest: payload, buildChannel: "qa", isSimulator: true), "[NATIVE-QA-20] observed mode needs loopback origins")
            payload = observed
            payload["cardOrigin"] = origin
            XCTAssertNil(QANetworkIsolation.resolve(manifest: payload, buildChannel: "qa", isSimulator: true), "[NATIVE-QA-20]")
        }
    }

    private func qaBuildValues() throws -> [String: Any] {
        ["CalledItBuildChannel": "qa", "CalledItFixtureMode": false, "CalledItAppGroup": "group.com.mikunad.calledit.qa",
         "CalledItKeychainGroup": "com.mikunad.calledit.qa.session", "CalledItSourceRevision": String(repeating: "a", count: 40)]
    }

    func testRunnerGateRejectsExpiredOversizedAndWrongSimulatorActivation() throws {
        var payload = manifest
        payload["expiresAt"] = now.timeIntervalSince1970 * 1000 - 1
        XCTAssertThrowsError(try NativeQARun(environment: self.environment(payload), now: now), "[NATIVE-QA-08]")
        payload = manifest
        payload["expiresAt"] = now.timeIntervalSince1970 * 1000 + 3_600_001
        XCTAssertThrowsError(try NativeQARun(environment: self.environment(payload), now: now), "[NATIVE-QA-09]")
        var environment = try self.environment(manifest)
        environment["SIMULATOR_UDID"] = UUID().uuidString
        XCTAssertThrowsError(try NativeQARun(environment: environment, now: now), "[NATIVE-QA-10]")
        environment = try self.environment(manifest)
        environment["CALLED_IT_QA_MANIFEST_BASE64"] = Data(repeating: 0x20, count: 16_385).base64EncodedString()
        XCTAssertThrowsError(try NativeQARun(environment: environment, now: now), "[NATIVE-QA-11]")
        environment = try self.environment(manifest)
        environment["CONVEX_DEPLOY_KEY"] = "SYNTHETIC_FORBIDDEN_CREDENTIAL"
        XCTAssertThrowsError(try NativeQARun(environment: environment, now: now), "[NATIVE-QA-12]")
    }
}
