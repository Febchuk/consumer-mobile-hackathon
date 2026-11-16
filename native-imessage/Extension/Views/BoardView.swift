import SwiftUI

struct BoardView: View {
    @EnvironmentObject var model: AppModel
    let roomId: String
    @State private var board: BoardResult?
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        Group {
            SheetHeader(leading: "Back", leadingAction: { model.home() }, title: board?.room.name ?? "Board")
            if let board {
                Text("Today's standings").font(.system(size: 28, weight: .bold))
                InsetGroup {
                    ForEach(Array(board.rows.enumerated()), id: \.element.id) { index, row in
                        InsetRow(last: index == board.rows.count - 1) {
                            Text("\(index + 1)").font(.system(size: 17, weight: .semibold).monospacedDigit()).foregroundStyle(Theme.sub).frame(width: 20)
                            Avatar(name: row.name, size: 32)
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 6) {
                                    Text(row.name).font(.system(size: 17, weight: index == 0 ? .semibold : .regular))
                                    if row.streak > 0 { Text("🔥\(row.streak)").font(.footnote.weight(.semibold)) }
                                }
                                Text("\(row.correct)/\(row.called) called").font(.system(size: 13)).foregroundStyle(Theme.sub)
                            }
                            Spacer()
                            Text(pts(row.points)).font(.system(size: 17, weight: .semibold).monospacedDigit())
                        }
                    }
                }
                PrimaryButton(title: "Send leaderboard") { model.send(Cards.board(board, session: nil)) }
                Footnote(text: "The card shows the top 3 names and points to this chat.")
            } else if loaded && error == nil {
                CardBox { Text("This leaderboard is for another group").font(.headline) }
            } else if error == nil {
                ProgressView().frame(maxWidth: .infinity).padding(40)
            }
            ErrorText(text: error)
        }
        .task { await load() }
    }

    private func load() async {
        guard let token = model.token else { return }
        do {
            board = try await API.query("ext:board", ["token": token, "roomId": roomId])
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}
