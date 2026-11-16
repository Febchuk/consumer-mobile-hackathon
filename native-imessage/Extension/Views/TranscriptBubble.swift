import Messages
import SwiftUI

struct TranscriptBubble: View {
    @EnvironmentObject var model: AppModel
    @State private var voters: [String] = []
    @State private var revealAt: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: -6) {
                Spacer()
                ForEach(Array(voters.prefix(5).enumerated()), id: \.offset) { _, name in
                    Avatar(name: name, size: 24).overlay(Circle().stroke(Color.white, lineWidth: 2))
                }
            }
            .frame(height: 24)
            InkBubble(name: model.bubbleSubject ?? "someone", height: 64)
            Text(status)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.leading, 6)
        }
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Called It bet about \(model.bubbleSubject ?? "someone"). Tap to open.")
        .task(id: model.bubbleBetId) { await load() }
    }

    private var status: String {
        guard let revealAt else { return "Tap to open in Called It" }
        return revealAt <= nowMs() ? "Revealed, tap to see the result" : "Reveals \(clock(revealAt)) · tap to open"
    }

    private func load() async {
        guard let token = model.token, let bet = model.bubbleBetId else { return }
        guard let card: BetCard = try? await API.query("ext:card", ["token": token, "betId": bet, "now": nowMs()]) else { return }
        guard card.access != "none" else { return }
        revealAt = card.revealAt
        if let who = card.who, !who.isEmpty {
            voters = who.map(\.name)
        } else {
            voters = (card.sides ?? []).flatMap { $0 }.map(\.name)
        }
    }
}
