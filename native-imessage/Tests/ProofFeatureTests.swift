import XCTest

final class ProofFeatureTests: XCTestCase {
    private let states = ["open", "locked", "revealed", "provisional", "finalized", "voided", "unknown"]

    func testProofIsOffByDefaultForV0() {
        XCTAssertFalse(ProofFeature.isEnabled, "[NATIVE-PROOF-GATE-01] proof photos and voice notes are cut from V0")
    }

    func testNoProofEntryExistsForAnyBetWhileTheFlagIsOff() throws {
        try XCTSkipIf(ProofFeature.isEnabled, "the flag is on; the entry rules are covered by testEntryNeverExistsOutsideRevealedStates")
        for state in states {
            for canAnswer in [true, false] {
                XCTAssertNil(ProofFeature.entry(betID: "synthetic-bet", state: state, canAnswer: canAnswer),
                             "[NATIVE-PROOF-GATE-02] ProofView cannot be built without an entry (\(state), canAnswer \(canAnswer))")
            }
        }
    }

    func testEntryNeverExistsOutsideRevealedStates() {
        for state in states {
            for canAnswer in [true, false] {
                let entry = ProofFeature.entry(betID: "synthetic-bet", state: state, canAnswer: canAnswer)
                let revealed = ["revealed", "provisional", "finalized"].contains(state)
                XCTAssertEqual(entry != nil, ProofFeature.isEnabled && revealed, "[NATIVE-PROOF-GATE-03] \(state)")
                if let entry {
                    XCTAssertEqual(entry.betID, "synthetic-bet", "[NATIVE-PROOF-GATE-04]")
                    XCTAssertEqual(entry.canUpload, canAnswer, "[NATIVE-PROOF-GATE-05] only the subject who can answer may upload")
                }
            }
        }
    }

    func testCopyMentionsProofOnlyWhenTheFlagIsOn() {
        for copy in [ProofFeature.answerFootnote, ProofFeature.hostPrivacyNote] {
            XCTAssertEqual(copy.localizedCaseInsensitiveContains("proof"), ProofFeature.isEnabled, "[NATIVE-PROOF-GATE-06] no copy points at a hidden screen")
        }
        XCTAssertTrue(ProofFeature.answerFootnote.contains("void 24 hours after reveal"), "[NATIVE-PROOF-GATE-07] the answer rules stay visible")
        XCTAssertTrue(ProofFeature.hostPrivacyNote.contains("reads no chats, contacts or photo library"), "[NATIVE-PROOF-GATE-08]")
    }
}
