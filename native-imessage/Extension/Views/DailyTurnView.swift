import SwiftUI

struct DailyTurnView: View {
    @EnvironmentObject var model: AppModel
    let groupID: String
    @State private var turn: CreatorTurn?
    @State private var busy = false
    @State private var moved: String?

    var body: some View {
        CardBox {
            if let turn {
                Text(turn.creatorId == model.session?.accountID ? "Your creator turn" : "Today's creator turn").font(.headline)
                Text("\(turn.localDate) · \(turn.status)").font(.subheadline).foregroundStyle(Theme.sub)
                if turn.offersBet(to: model.session?.accountID) {
                    Text("Make a bet about your assigned friend, or pass the turn. The server manages the rotation and deadlines.")
                        .font(.subheadline)
                    PrimaryButton(title: "Create today's bet", busy: busy) { Task { await create() } }
                        .accessibilityIdentifier("turn.create")
                }
                if turn.canPass {
                    Button("Pass my turn") { Task { await pass() } }
                        .disabled(busy || model.me?.policy.approved != true)
                        .frame(minHeight: 44).accessibilityIdentifier("turn.pass")
                }
            } else {
                Text("No creator turn available").font(.headline)
                Text("Turn scheduling is controlled by the server's approved group policy.").font(.footnote).foregroundStyle(Theme.sub)
            }
            if let moved {
                Text(moved).font(.subheadline).accessibilityIdentifier("turn.moved")
            }
        }
        .task(id: groupID) { await load() }
        .onChange(of: model.activeTick) { _, _ in Task { await load() } }
    }

    private func read(_ token: String) async throws -> CreatorTurn? {
        let result: CreatorTurn? = try await API.query("v0Groups:turn", ["token": token, "groupId": groupID])
        guard result == nil || result?.groupId == groupID else { throw NativeError.invalidLink }
        return result
    }

    private func load() async {
        guard let token = model.token else { return }
        do {
            let result = try await read(token)
            guard model.token == token else { return }
            turn = result
        } catch { turn = nil; model.handle(error, loading: true) }
    }

    /// The card may have been read hours ago, and the turn passes at noon without the person doing anything. The turn is
    /// read again before the form opens, so a turn that has moved changes the card here instead of failing after the bet
    /// is written. A read that fails opens the form anyway; the server still decides when the bet is created.
    private func create() async {
        guard let token = model.token, let shown = turn, !busy else { return }
        busy = true
        defer { busy = false }
        let current: CreatorTurn?
        do { current = try await read(token) } catch { return model.compose(subjectID: shown.subjectId) }
        guard model.token == token else { return }
        turn = current
        if let current, current.offersBet(to: model.session?.accountID) { return model.compose(subjectID: current.subjectId) }
        guard let current else { return moved = "Your turn is over, so there's no bet to make from it." }
        if current.creatorId != model.session?.accountID { moved = "Your turn passed to another member, so today's bet is theirs to make." }
        else if current.status == "created" { moved = "Today's bet has already been made from your turn." }
        else { moved = "Your turn ended without a bet, so there's no bet to make from it today." }
    }

    private func pass() async {
        guard let token = model.token, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let _: Ignored? = try await API.mutation("v0Groups:passTurn", ["token": token, "groupId": groupID, "requestId": UUID().uuidString])
            await load()
        } catch { model.handle(error) }
    }
}
