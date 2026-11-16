import SwiftUI

struct InkNoise: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 15)) { timeline in
            Canvas { ctx, size in
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Theme.bubble))
                var rng = SeededRandom(seed: UInt64(timeline.date.timeIntervalSinceReferenceDate * 15))
                let count = Int(size.width * size.height / 14)
                for _ in 0..<count {
                    let x = CGFloat(rng.next() % 10_000) / 10_000 * size.width
                    let y = CGFloat(rng.next() % 10_000) / 10_000 * size.height
                    let shade = Double(rng.next() % 100) / 100
                    ctx.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 1.6, height: 1.6)), with: .color(Color(white: 0.45 + shade * 0.35)))
                }
            }
        }
        .accessibilityHidden(true)
    }
}

struct SeededRandom {
    private var state: UInt64
    init(seed: UInt64) { state = seed &+ 0x9E3779B97F4A7C15 }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

struct InkBubble: View {
    let name: String
    var height: CGFloat = 88

    var body: some View {
        ZStack(alignment: .topLeading) {
            InkNoise()
            Text("@\(name)")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .padding(.horizontal, 14).padding(.vertical, 10)
        }
        .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Hidden bet about \(name)")
    }
}

func countdown(to ms: Double, from date: Date) -> String {
    let left = max(0, Int((ms / 1000 - date.timeIntervalSince1970).rounded(.up)))
    return String(format: "%d:%02d:%02d", left / 3600, (left % 3600) / 60, left % 60)
}

struct RubToReveal<Content: View>: View {
    let name: String
    @Binding var uncovered: Bool
    @ViewBuilder var content: Content
    @State private var strokes: [CGPoint] = []

    var body: some View {
        ZStack(alignment: .topLeading) {
            content
                .frame(maxWidth: .infinity, minHeight: 88, alignment: .topLeading)
                .accessibilityHidden(!uncovered)
            if !uncovered {
                InkBubble(name: name)
                    .mask {
                        Canvas { ctx, size in
                            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.black))
                            ctx.blendMode = .destinationOut
                            for p in strokes {
                                ctx.fill(Path(ellipseIn: CGRect(x: p.x - 24, y: p.y - 24, width: 48, height: 48)), with: .color(.black))
                            }
                        }
                    }
                    .overlay(alignment: .bottomTrailing) {
                        if strokes.isEmpty {
                            Text("Rub to uncover").font(.footnote.weight(.semibold)).foregroundStyle(Theme.sub).padding(10)
                        }
                    }
                    .highPriorityGesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                strokes.append(value.location)
                                if strokes.count > 60 { withAnimation(.easeOut(duration: 0.4)) { uncovered = true } }
                            }
                    )
                    .transition(.opacity)
                    .accessibilityElement()
                    .accessibilityLabel("Covered by invisible ink")
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { uncovered = true }
            }
        }
    }
}
