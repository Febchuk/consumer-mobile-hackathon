import Foundation

struct Person: Decodable, Hashable {
    let _id: String?
    let name: String
    let emoji: String
}

struct Member: Decodable, Identifiable, Hashable {
    let _id: String
    let name: String
    let emoji: String
    let points: Double?
    var id: String { _id }
}

struct Room: Decodable, Identifiable {
    let _id: String
    let name: String
    let inviteCode: String?
    let revealAt: Double?
    let members: [Member]
    var id: String { _id }
}

struct MeUser: Decodable {
    let _id: String
    let name: String
    let emoji: String
}

struct MeResult: Decodable {
    let user: MeUser
    let rooms: [Room]
}

struct PairResult: Decodable {
    let token: String
    let user: MeUser
}

struct RoomRef: Decodable {
    let _id: String
    let name: String
}

struct Mine: Decodable {
    let option: Int
    let amount: Double
}

struct SidePerson: Decodable, Hashable {
    let name: String
    let emoji: String
    let amount: Double
    let me: Bool?
}

struct BetCard: Decodable {
    let access: String
    let room: RoomRef?
    let subject: Person?
    let revealAt: Double?
    let bettors: [String]?
    let total: Double?
    let author: Person?
    let ai: Bool?
    let question: String?
    let kind: String?
    let options: [String]?
    let line: Double?
    let pct: [Double]?
    let pools: [Double]?
    let status: String?
    let winningOption: Int?
    let revealed: Bool?
    let isSubject: Bool?
    let canDeclare: Bool?
    let mine: Mine?
    let points: Double?
    let sides: [[SidePerson]]?
    let who: [WhoBet]?
}

struct WhoBet: Decodable, Hashable {
    let name: String
    let emoji: String
    let amount: Double
}

struct BoardRow: Decodable, Identifiable {
    let _id: String
    let name: String
    let emoji: String
    let points: Double
    let streak: Int
    let correct: Int
    let called: Int
    var id: String { _id }
}

struct BoardResult: Decodable {
    let room: RoomRef
    let rows: [BoardRow]
}

struct Suggestion: Decodable, Identifiable {
    let subject: String
    let kind: String
    let question: String
    let line: Double?
    let options: [String]?
    let why: String?
    var id: String { subject + question }
}

struct Face: Decodable, Hashable {
    let emoji: String
    let name: String
}

struct ThreadItem: Decodable, Identifiable {
    let type: String
    let _id: String
    let question: String?
    let subject: Person?
    let pct: [Double]?
    let options: [String]?
    let status: String?
    let total: Double?
    let faces: [Face]?
    var id: String { _id }
}

struct ThreadResult: Decodable {
    let items: [ThreadItem]
}
