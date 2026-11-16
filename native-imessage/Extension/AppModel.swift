import CryptoKit
import Messages
import SwiftUI
import UIKit

enum Screen: Equatable {
    case home
    case link
    case newBet
    case bet(room: String, bet: String)
    case board(String)
}

@MainActor
final class AppModel: ObservableObject {
    @Published var screen: Screen = .home
    @Published var style: MSMessagesAppPresentationStyle = .compact
    @Published var token: String? = Keychain.load()
    @Published var me: MeResult?
    @Published var linkedRoomId: String?
    @Published var error: String?

    weak var controller: MessagesViewController?
    private var conversationKey: String?

    var linkedRoom: Room? { me?.rooms.first { $0.id == linkedRoomId } }

    func attach(_ conversation: MSConversation) {
        let remotes = conversation.remoteParticipantIdentifiers.map(\.uuidString).sorted().joined(separator: ",")
        let digest = SHA256.hash(data: Data(remotes.utf8)).map { String(format: "%02x", $0) }.joined()
        let key = conversation.localParticipantIdentifier.uuidString + ":" + digest
        conversationKey = key
        linkedRoomId = Links.room(for: key)
        Task { await refresh() }
    }

    func refresh() async {
        guard let token else { return }
        do {
            let result: MeResult? = try await API.query("ext:me", ["token": token])
            guard let result else { return signOut() }
            me = result
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func signedIn(_ pair: PairResult) async {
        Keychain.save(pair.token)
        token = pair.token
        await refresh()
    }

    func signOut() {
        Keychain.delete()
        token = nil
        me = nil
        screen = .home
    }

    func link(_ roomId: String) {
        linkedRoomId = roomId
        if let conversationKey { Links.set(roomId, for: conversationKey) }
        screen = .home
    }

    func open(_ message: MSMessage) {
        guard let url = message.url, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), parts.scheme == "calledit" else { return }
        let q = Dictionary((parts.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
        guard let room = q["r"], !room.isEmpty else { return }
        if parts.host == "bet", let bet = q["b"], !bet.isEmpty {
            screen = .bet(room: room, bet: bet)
        } else if parts.host == "board" {
            screen = .board(room)
        }
    }

    func home() {
        screen = .home
    }

    func go(_ next: Screen) {
        screen = next
        if style != .expanded { controller?.requestPresentationStyle(.expanded) }
    }

    func openWeb() {
        controller?.extensionContext?.open(Config.web)
    }

    func send(_ message: MSMessage) {
        guard let conversation = controller?.activeConversation else {
            error = "Open a conversation first."
            return
        }
        conversation.insert(message) { [weak self] err in
            guard let err else { return }
            Task { @MainActor in self?.error = err.localizedDescription }
        }
        controller?.requestPresentationStyle(.compact)
    }

    var selectedSession: MSSession? { controller?.activeConversation?.selectedMessage?.session }
}

enum Links {
    private static let key = "calledit.links"

    static func room(for conversation: String) -> String? {
        (UserDefaults.standard.dictionary(forKey: key) as? [String: String])?[conversation] ?? UserDefaults.standard.string(forKey: key + ".last")
    }

    static func set(_ room: String, for conversation: String) {
        var all = (UserDefaults.standard.dictionary(forKey: key) as? [String: String]) ?? [:]
        all[conversation] = room
        UserDefaults.standard.set(all, forKey: key)
        UserDefaults.standard.set(room, forKey: key + ".last")
    }
}

enum Cards {
    static func bet(roomId: String, betId: String, subject: Person?, revealAt: Double?, bettors: [String], session: MSSession?) -> MSMessage {
        let name = subject?.name ?? "a friend"
        let layout = MSMessageTemplateLayout()
        layout.caption = "🔒 A bet about \(name)"
        if let revealAt { layout.subcaption = "Reveal \(clock(revealAt))" }
        layout.trailingSubcaption = bettors.joined()
        layout.image = art(top: "🔒", bottom: subject?.emoji ?? "")
        let message = MSMessage(session: session ?? MSSession())
        message.layout = layout
        message.url = url("bet", ["r": roomId, "b": betId])
        message.summaryText = "Called It bet"
        message.accessibilityLabel = "Called It bet about \(name)"
        return message
    }

    static func result(roomId: String, betId: String, card: BetCard, session: MSSession?) -> MSMessage {
        let name = card.subject?.name ?? "Someone"
        let layout = MSMessageTemplateLayout()
        if card.status == "refunded" {
            layout.caption = "\(name) vetoed a bet"
            layout.subcaption = "Everyone got their points back"
        } else {
            layout.caption = "\(name) called it"
            if card.revealed == true, let win = card.winningOption, let options = card.options, options.indices.contains(win) {
                layout.subcaption = "It was \(options[win])"
            } else {
                layout.subcaption = "Settled"
            }
        }
        layout.trailingSubcaption = (card.bettors ?? []).joined()
        layout.image = art(top: "✓", bottom: card.subject?.emoji ?? "")
        let message = MSMessage(session: session ?? MSSession())
        message.layout = layout
        message.url = url("bet", ["r": roomId, "b": betId])
        message.summaryText = "Called It result"
        message.accessibilityLabel = "Called It result"
        return message
    }

    static func board(_ board: BoardResult, session: MSSession?) -> MSMessage {
        let layout = MSMessageTemplateLayout()
        layout.caption = "\(board.room.name) leaderboard"
        layout.subcaption = board.rows.prefix(3).map { "\($0.name) \(pts($0.points))" }.joined(separator: " · ")
        layout.image = art(top: "🏆", bottom: board.rows.prefix(3).map(\.emoji).joined())
        let message = MSMessage(session: session ?? MSSession())
        message.layout = layout
        message.url = url("board", ["r": board.room._id])
        message.summaryText = "Called It leaderboard"
        message.accessibilityLabel = "\(board.room.name) leaderboard"
        return message
    }

    private static func url(_ host: String, _ query: [String: String]) -> URL? {
        var parts = URLComponents()
        parts.scheme = "calledit"
        parts.host = host
        parts.queryItems = query.sorted { $0.key > $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        return parts.url
    }

    private static func art(top: String, bottom: String) -> UIImage {
        let size = CGSize(width: 600, height: 300)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            UIColor(Theme.bubble).setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            let style = NSMutableParagraphStyle()
            style.alignment = .center
            let line = "\(top)  \(bottom)"
            let attrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 96, weight: .bold),
                .foregroundColor: UIColor.label,
                .paragraphStyle: style,
            ]
            (line as NSString).draw(in: CGRect(x: 0, y: 90, width: size.width, height: 130), withAttributes: attrs)
        }
    }
}
