import Foundation

enum ProofFeature {
    static let isEnabled = false

    struct Entry: Equatable {
        let betID: String
        let canUpload: Bool

        fileprivate init(betID: String, canUpload: Bool) {
            self.betID = betID
            self.canUpload = canUpload
        }
    }

    static func entry(betID: String, state: String, canAnswer: Bool) -> Entry? {
        guard isEnabled, ["revealed", "provisional", "finalized"].contains(state) else { return nil }
        return Entry(betID: betID, canUpload: canAnswer)
    }

    static var answerFootnote: String {
        (isEnabled ? "Proof is optional; upload it before answering. " : "") +
            "Unanswered bets void 24 hours after reveal. Your recorded answer starts a one-hour challenge window; the server owns both deadlines."
    }

    static var hostPrivacyNote: String {
        "V0 reads no chats, contacts or photo library. " + (isEnabled ? "You choose any proof you share. " : "") +
            "Cards are sent only when you tap Send in Messages."
    }
}
