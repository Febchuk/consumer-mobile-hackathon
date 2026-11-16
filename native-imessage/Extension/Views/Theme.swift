import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

enum Theme {
    static let page = Color(hex: 0xF2F2F7)
    static let pageUI = Color(hex: 0xF2F2F7)
    static let ink = Color.primary
    static let sub = Color(.secondaryLabel)
    static let accent = Color(hex: 0x0A7AFF)
    static let green = Color(hex: 0x22903F)
    static let red = Color(hex: 0xD7001A)
    static let bubble = Color(hex: 0xE9E9EB)
    static let gold = Color(hex: 0xE8C25A)
    static let line = Color(.separator)
    static let yesSoft = Color(hex: 0xE9E9EB)
    static let avatars: [Color] = [0xE07B2E, 0x3E8E5E, 0x6E5BD3, 0xC44E7A, 0xA8714F, 0x4E86D6].map { Color(hex: $0) }

    static func verdict(_ i: Int) -> Color { i == 0 ? green : red }

    static func avatarColor(_ seed: String) -> Color {
        let sum = seed.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF }
        return avatars[sum % avatars.count]
    }
}

struct Avatar: View {
    var name: String?
    var emoji: String?
    var size: CGFloat = 32
    var ring: Color? = nil

    var body: some View {
        let seed = name ?? emoji ?? "?"
        ZStack {
            Circle().fill(Theme.avatarColor(seed))
            if let name, !name.isEmpty {
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: size * 0.45, weight: .semibold))
                    .foregroundStyle(.white)
            } else {
                Image(systemName: "person.fill").font(.system(size: size * 0.45)).foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().stroke(ring ?? .clear, lineWidth: 3).padding(-4))
    }
}

struct CIAvatar: View {
    var size: CGFloat = 32

    var body: some View {
        ZStack {
            Circle().fill(Color.black)
            Text("CI").font(.system(size: size * 0.38, weight: .heavy)).foregroundStyle(Theme.gold)
        }
        .frame(width: size, height: size)
    }
}

struct AvatarStack: View {
    let people: [(name: String?, emoji: String?)]
    var size: CGFloat = 28

    var body: some View {
        HStack(spacing: -size * 0.3) {
            ForEach(Array(people.prefix(6).enumerated()), id: \.offset) { _, p in
                Avatar(name: p.name, emoji: p.emoji, size: size)
                    .overlay(Circle().stroke(Color.white, lineWidth: 2))
            }
        }
    }
}

struct SheetHeader: View {
    var leading: String?
    var leadingAction: (() -> Void)?
    let title: String
    var trailing: String?
    var trailingBold = false
    var trailingAction: (() -> Void)?

    var body: some View {
        ZStack {
            Text(title).font(.headline).lineLimit(1).padding(.horizontal, 80)
            HStack {
                if let leading { Button(leading) { leadingAction?() }.font(.body).foregroundStyle(Theme.accent) }
                Spacer()
                if let trailing {
                    if let trailingAction {
                        Button(trailing, action: trailingAction)
                            .font(.body.weight(trailingBold ? .semibold : .regular))
                            .foregroundStyle(Theme.accent)
                    } else {
                        Text(trailing).font(.subheadline).foregroundStyle(Theme.sub)
                    }
                }
            }
        }
        .padding(.bottom, 4)
    }
}

struct CardBox<Content: View>: View {
    var padding: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
    }
}

struct InsetRow<Content: View>: View {
    var last = false
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            HStack { content }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .padding(.vertical, 6)
            if !last { Divider().padding(.leading, 16) }
        }
    }
}

struct InsetGroup<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct PrimaryButton: View {
    let title: String
    var color: Color = Theme.accent
    var busy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title).opacity(busy ? 0 : 1)
                if busy { ProgressView().tint(.white) }
            }
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(color))
            .foregroundStyle(.white)
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }
}

struct SoftButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.body)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .foregroundStyle(Theme.accent)
        }
        .buttonStyle(.plain)
    }
}

struct ErrorText: View {
    let text: String?

    var body: some View {
        if let text {
            Text(text).font(.footnote.weight(.medium)).foregroundStyle(Theme.red)
        }
    }
}

struct SectionTitle: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.footnote)
            .foregroundStyle(Theme.sub)
            .padding(.leading, 16)
            .padding(.top, 6)
    }
}

struct Footnote: View {
    let text: String

    var body: some View {
        Text(text).font(.footnote).foregroundStyle(Theme.sub).padding(.horizontal, 16)
    }
}

struct Chip: View {
    let title: String
    let on: Bool
    var color: Color = Theme.accent
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Capsule().fill(on ? color : Color(hex: 0xE9E9EB)))
                .foregroundStyle(on ? Color.white : color)
        }
        .buttonStyle(.plain)
    }
}

struct QuestionBubble: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.body)
            .foregroundStyle(.primary)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.bubble))
            .fixedSize(horizontal: false, vertical: true)
    }
}
