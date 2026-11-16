import SwiftUI

struct LinkRoomView: View {
    @EnvironmentObject var model: AppModel
    @State private var newName = ""
    @State private var invite = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Text("Link this chat").font(.system(size: 28, weight: .bold))
        Footnote(text: "Pick the Called It room for this conversation. It's saved on this device only.")
        if let rooms = model.me?.rooms {
            InsetGroup {
                ForEach(Array(rooms.enumerated()), id: \.element.id) { index, room in
                    Button { model.link(room.id) } label: {
                        InsetRow(last: index == rooms.count - 1) {
                            AvatarStack(people: room.members.map { (name: $0.name, emoji: $0.emoji) }, size: 28)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(room.name).font(.system(size: 17, weight: .semibold))
                                Text("\(room.members.count) people").font(.system(size: 13)).foregroundStyle(Theme.sub)
                            }
                            Spacer()
                            if room.id == model.linkedRoomId {
                                Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(Theme.accent)
                            }
                        }
                        .foregroundStyle(.primary)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        } else {
            ProgressView().frame(maxWidth: .infinity)
        }
        SectionTitle(text: "New room")
        InsetGroup {
            InsetRow { TextField("Room name", text: $newName) }
            InsetRow(last: true) {
                Button("Create room") { Task { await create() } }
                    .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                Spacer()
            }
        }
        SectionTitle(text: "Join with invite code")
        InsetGroup {
            InsetRow {
                TextField("Invite code", text: $invite)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
            }
            InsetRow(last: true) {
                Button("Join") { Task { await join() } }.disabled(invite.isEmpty || busy)
                Spacer()
            }
        }
        ErrorText(text: error)
    }

    private func create() async { await run("chat:createGroup", ["name": newName.trimmingCharacters(in: .whitespaces)]) }
    private func join() async { await run("chat:join", ["invite": invite.trimmingCharacters(in: .whitespaces)]) }

    private func run(_ path: String, _ args: [String: Any]) async {
        guard let token = model.token else { return }
        busy = true
        defer { busy = false }
        do {
            var all = args
            all["token"] = token
            guard let roomId: String = try await API.mutation(path, all) else { return }
            await model.refresh()
            model.link(roomId)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
