import SwiftUI

struct LinkRoomView: View {
    @EnvironmentObject var model: AppModel
    @State private var newName = ""
    @State private var invite = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Text("Link this chat").font(.largeTitle.bold())
        Footnote(text: "Pick the Called It group this conversation plays in. The link is saved on this device only. Called It can't see who's in this chat.")
        if model.notMemberOfPending {
            CardBox {
                Text("You're not in this group yet").font(.headline)
                Text("Ask a friend for the group invite code and enter it below.").font(.subheadline).foregroundStyle(Theme.sub)
            }
        }
        SectionTitle(text: "Your groups")
        if let rooms = model.me?.rooms {
            InsetGroup {
                if rooms.isEmpty {
                    InsetRow(last: true) { Text("You're not in any groups yet.").foregroundStyle(Theme.sub); Spacer() }
                }
                ForEach(Array(rooms.enumerated()), id: \.element.id) { index, room in
                    Button { model.link(room.id) } label: {
                        InsetRow(last: index == rooms.count - 1) {
                            AvatarStack(people: room.members.map { (name: $0.name, emoji: nil) }, size: 28)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(room.name).font(.headline)
                                Text("\(room.members.count) people").font(.footnote).foregroundStyle(Theme.sub)
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
        SectionTitle(text: "Join with a group invite code")
        InsetGroup {
            InsetRow {
                TextField("Group invite code", text: $invite)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("inviteCode")
            }
            InsetRow(last: true) {
                Button("Join group") { Task { await join() } }.disabled(invite.isEmpty || busy)
                Spacer()
            }
        }
        Footnote(text: "A group invite code joins a group. It's different from the account pairing code you used to sign in.")
        SectionTitle(text: "Or start a new group")
        Footnote(text: "Called It keeps a private scoreboard for this chat. We make a matching group so your bets, points and the reveal stay with this conversation.")
        InsetGroup {
            InsetRow { TextField("Group name", text: $newName).accessibilityIdentifier("newGroupName") }
            InsetRow(last: true) {
                Button("Create group") { Task { await create() } }
                    .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty || busy)
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
