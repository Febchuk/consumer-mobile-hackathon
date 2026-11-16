import SwiftUI

struct BetView: View {
    @EnvironmentObject var model: AppModel
    let roomId: String
    let betId: String
    @State private var card: BetCard?
    @State private var error: String?
    @State private var busy = false
    @State private var uncovered = false
    @State private var side: Int?
    @State private var amount: Double = 100
    @State private var confirmVeto = false

    var body: some View {
        Group {
            if let card {
                switch card.access {
                case "sealed": sealed(card)
                case "open": open(card)
                default: noAccess
                }
            } else if error == nil {
                ProgressView().frame(maxWidth: .infinity).padding(40)
            }
            ErrorText(text: error)
        }
        .task { await poll() }
    }

    private var noAccess: some View {
        CardBox {
            Text("This bet is for another group").font(.headline)
            Button("Join with invite code") { model.screen = .link }
        }
    }

    @ViewBuilder private func sealed(_ card: BetCard) -> some View {
        let name = card.subject?.name ?? "you"
        let revealAt = card.revealAt ?? nowMs()
        SheetHeader(title: "About you", trailing: "Done", trailingBold: true) { model.home() }
        VStack(alignment: .leading, spacing: 4) {
            Text("Today's bet is about you").font(.system(size: 28, weight: .bold))
            TimelineView(.periodic(from: .now, by: 1)) { t in
                Text("Unlocks at \(clock(revealAt)) · in \(countdown(to: revealAt, from: t.date))")
                    .font(.subheadline.monospacedDigit()).foregroundStyle(Theme.sub)
            }
        }
        CardBox {
            HStack(alignment: .top, spacing: 8) {
                CIAvatar(size: 28)
                InkBubble(name: name)
            }
            HStack(spacing: 10) {
                AvatarStack(people: bettorFaces(card))
                Text((card.bettors?.count ?? 0) == 1 ? "1 friend bet" : "\(card.bettors?.count ?? 0) friends bet").font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(pts(card.total ?? 0)) pts in").font(.subheadline.monospacedDigit()).foregroundStyle(Theme.sub)
            }
        }
        SectionTitle(text: "Who bet · sides hidden")
        InsetGroup {
            let who = card.who ?? []
            if who.isEmpty {
                ForEach(Array((card.bettors ?? []).enumerated()), id: \.offset) { i, emoji in
                    InsetRow(last: i == (card.bettors?.count ?? 1) - 1) { Avatar(emoji: emoji, size: 30); Spacer() }
                }
                if card.bettors?.isEmpty ?? true { InsetRow(last: true) { Text("Nobody yet").foregroundStyle(Theme.sub) } }
            } else {
                ForEach(Array(who.enumerated()), id: \.offset) { i, p in
                    InsetRow(last: i == who.count - 1) {
                        Avatar(name: p.name, size: 30)
                        Text(p.name)
                        Spacer()
                        Text("\(pts(p.amount)) pts").monospacedDigit().foregroundStyle(Theme.sub)
                    }
                }
            }
        }
        Footnote(text: "You'll see the question at \(clock(revealAt)), then you say what really happened.")
    }

    private func bettorFaces(_ card: BetCard) -> [(name: String?, emoji: String?)] {
        if let who = card.who, !who.isEmpty { return who.map { (name: $0.name, emoji: $0.emoji) } }
        return (card.bettors ?? []).map { (name: nil, emoji: $0) }
    }

    @ViewBuilder private func open(_ card: BetCard) -> some View {
        if card.isSubject == true {
            verdict(card)
        } else {
            takeSide(card)
        }
        if card.status == "settled" || card.status == "refunded" {
            ResultBlock(card: card)
            PrimaryButton(title: "Send result") {
                model.send(Cards.result(roomId: roomId, betId: betId, card: card, session: model.selectedSession))
            }
        }
    }

    private func labels(_ card: BetCard) -> [String] {
        let o = card.options ?? []
        return [o[safe: 0] ?? "Yes", o[safe: 1] ?? "No"]
    }

    private func asker(_ card: BetCard) -> some View {
        HStack(alignment: .bottom, spacing: 8) {
            if card.ai == true || card.author == nil { CIAvatar(size: 28) } else { Avatar(name: card.author?.name, size: 28) }
            VStack(alignment: .leading, spacing: 3) {
                Text(card.ai == true ? "Created by AI" : (card.author?.name ?? "Called It")).font(.caption).foregroundStyle(Theme.sub).padding(.leading, 12)
                QuestionBubble(text: card.question ?? "")
            }
            Spacer(minLength: 30)
        }
    }

    @ViewBuilder private func takeSide(_ card: BetCard) -> some View {
        let name = card.subject?.name ?? "them"
        let options = labels(card)
        let pools = card.pools ?? [0, 0]
        let total = card.total ?? 0
        let points = max(0, card.points ?? 0)
        let open = card.status == "open"
        let chosen = side ?? card.mine?.option
        SheetHeader(leading: "Cancel", leadingAction: { model.home() }, title: "Bet on \(name)", trailing: "locks \(clock(card.revealAt ?? nowMs()))")
        asker(card)
        InsetGroup {
            ForEach(0..<2, id: \.self) { i in
                let pool = pools[safe: i] ?? 0
                let pct = Int((card.pct?[safe: i] ?? 50).rounded())
                let locked = card.mine != nil && card.mine?.option != i
                Button {
                    if open && !locked { side = i }
                } label: {
                    InsetRow(last: i == 1) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(options[i] + (card.status == "settled" && card.winningOption == i ? "  ✓ won" : ""))
                                .font(.system(size: 17, weight: chosen == i ? .semibold : .regular))
                            Text("\(pct)% picked this · pays \(multiple(total: total, pool: pool))")
                                .font(.system(size: 13)).foregroundStyle(Theme.sub)
                        }
                        Spacer()
                        Image(systemName: chosen == i ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(chosen == i ? Theme.accent : Color(.tertiaryLabel))
                    }
                    .foregroundStyle(.primary)
                    .opacity(locked ? 0.45 : 1)
                }
                .buttonStyle(.plain)
            }
        }
        if open {
            SectionTitle(text: "How sure are you")
            CardBox {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(pts(amount)).font(.system(size: 40, weight: .bold).monospacedDigit())
                    Text("pts").font(.title3).foregroundStyle(Theme.sub)
                    Spacer()
                    Text("You have \(pts(points)) left").font(.subheadline).foregroundStyle(Theme.sub)
                }
                if points > 10 {
                    Slider(value: $amount, in: 10...points, step: 10).tint(Theme.accent)
                }
                HStack(spacing: 8) {
                    ForEach([50.0, 100, 250], id: \.self) { v in
                        Chip(title: pts(v), on: false) { amount = min(v, points) }
                    }
                    Chip(title: "All in", on: false) { amount = points }
                }
            }
            HStack(spacing: 8) {
                let people = (card.sides ?? []).flatMap { $0 }
                AvatarStack(people: people.map { (name: $0.name, emoji: $0.emoji) }, size: 26)
                Text(alreadyBet(people)).font(.subheadline).foregroundStyle(Theme.sub).lineLimit(1)
                Spacer()
                if let s = chosen {
                    Text("Win ≈ \(pts(win(amount, pool: pools[safe: s] ?? 0, total: total)))").font(.subheadline.weight(.bold).monospacedDigit())
                }
            }
            .padding(.horizontal, 4)
            PrimaryButton(title: card.mine == nil ? "Call it" : "Add \(pts(amount)) more", busy: busy) {
                guard let s = chosen else { error = "Pick a side first."; return }
                Task { await mutate("chat:stake", ["option": s, "amount": Int(amount)]) }
            }
            .opacity(chosen == nil || amount < 1 ? 0.5 : 1)
            Footnote(text: "\(name) won't see this bet until \(clock(card.revealAt ?? nowMs())).")
            SoftButton(title: "Send update") {
                model.send(Cards.bet(roomId: roomId, betId: betId, subject: card.subject, revealAt: card.revealAt, bettors: card.bettors ?? [], session: model.selectedSession))
            }
            Footnote(text: "The update card shows who it's about, the reveal time and who's in. Never the question.")
        } else {
            PositionsBlock(card: card)
        }
    }

    @ViewBuilder private func verdict(_ card: BetCard) -> some View {
        let options = labels(card)
        SheetHeader(leading: "Close", leadingAction: { model.home() }, title: "Your bet for today")
        Text("Your friends bet on whether…").font(.system(size: 22, weight: .bold))
        if card.status == "open" {
            RubToReveal(name: card.subject?.name ?? "you", uncovered: $uncovered) { asker(card) }
        } else {
            asker(card)
        }
        if uncovered || card.status != "open" {
            PositionsBlock(card: card)
            if card.canDeclare == true {
                Text("So... is it true?").font(.system(size: 22, weight: .bold)).padding(.top, 6)
                HStack(spacing: 10) {
                    ForEach(0..<2, id: \.self) { i in
                        PrimaryButton(title: card.kind == "yesno" ? (i == 0 ? "Yeah, guilty" : "Nope, never") : options[i], color: Theme.verdict(i), busy: busy) {
                            Task { await mutate("chat:declare", ["winningOption": i]) }
                        }
                    }
                }
                HStack {
                    Footnote(text: "Honor system. Proof is optional.")
                    Spacer()
                    Button("Veto") { confirmVeto = true }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.sub)
                        .confirmationDialog("Veto this bet? Everyone gets their points back.", isPresented: $confirmVeto, titleVisibility: .visible) {
                            Button("Veto", role: .destructive) { Task { await mutate("chat:veto", [:]) } }
                        }
                }
            }
        }
    }

    private func alreadyBet(_ people: [SidePerson]) -> String {
        let names = people.map { $0.me == true ? "You" : $0.name }
        switch names.count {
        case 0: return "Nobody's bet yet"
        case 1: return "\(names[0]) already bet"
        case 2: return "\(names[0]) and \(names[1]) already bet"
        default: return "\(names[0]) and \(names.count - 1) others already bet"
        }
    }

    private func multiple(total: Double, pool: Double) -> String {
        guard pool > 0, total > 0 else { return "—" }
        return String(format: "%.1f×", total / pool)
    }

    private func win(_ stake: Double, pool: Double, total: Double) -> Double {
        stake / (pool + stake) * (total + stake)
    }

    private func poll() async {
        while !Task.isCancelled {
            await load()
            try? await Task.sleep(for: .seconds(8))
        }
    }

    private func load() async {
        guard let token = model.token else { return }
        do {
            let next: BetCard? = try await API.query("ext:card", ["token": token, "betId": betId, "now": nowMs()])
            if let next, next.status != "open" { uncovered = true }
            if card == nil, let points = next?.points, points > 0 { amount = min(100, points) }
            card = next
            error = nil
        } catch {
            if card == nil { self.error = error.localizedDescription }
        }
    }

    private func mutate(_ path: String, _ args: [String: Any]) async {
        guard let token = model.token else { return }
        busy = true
        defer { busy = false }
        var all = args
        all["token"] = token
        all["betId"] = betId
        do {
            let _: Ignored? = try await API.mutation(path, all)
            error = nil
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct PositionsBlock: View {
    let card: BetCard

    var body: some View {
        let options = card.options ?? []
        let sides = card.sides ?? []
        SectionTitle(text: "Everyone's positions")
        InsetGroup {
            ForEach(0..<2, id: \.self) { i in
                let people = sides[safe: i] ?? []
                InsetRow(last: i == 1) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(options[safe: i] ?? "").font(.system(size: 17, weight: .semibold))
                            Spacer()
                            Text("\(Int((card.pct?[safe: i] ?? 0).rounded()))%").font(.subheadline.monospacedDigit()).foregroundStyle(Theme.sub)
                        }
                        if people.isEmpty { Text("Nobody").font(.footnote).foregroundStyle(Theme.sub) }
                        ForEach(people, id: \.self) { p in
                            HStack(spacing: 8) {
                                Avatar(name: p.name, size: 24)
                                Text(p.me == true ? "You" : p.name).font(.subheadline)
                                Spacer()
                                Text("\(pts(p.amount)) pts").font(.footnote.monospacedDigit()).foregroundStyle(Theme.sub)
                            }
                        }
                    }
                }
            }
        }
    }
}

struct ResultBlock: View {
    let card: BetCard

    var body: some View {
        CardBox {
            if card.status == "refunded" {
                Text("Vetoed").font(.title3.weight(.bold))
                Text("Everyone got their points back.").font(.subheadline).foregroundStyle(Theme.sub)
            } else if let win = card.winningOption {
                Text("It was \(card.options?[safe: win] ?? "")").font(.title3.weight(.bold)).foregroundStyle(Theme.verdict(win))
                Text("PAYOUTS").font(.system(size: 13)).foregroundStyle(Theme.sub)
                ForEach(rows(win), id: \.0) { row in
                    HStack {
                        Text(row.0)
                        Spacer()
                        Text(row.1).font(.subheadline.weight(.bold).monospacedDigit()).foregroundStyle(row.2 ? Theme.green : Theme.red)
                    }
                }
            }
        }
    }

    private func rows(_ win: Int) -> [(String, String, Bool)] {
        let sides = card.sides ?? []
        let total = card.total ?? 0
        let pool = card.pools?[safe: win] ?? 0
        var out: [(String, String, Bool)] = []
        for (i, people) in sides.enumerated() {
            for p in people {
                let who = p.me == true ? "You" : p.name
                if i == win, pool > 0 {
                    out.append((who, "+\(pts(p.amount / pool * total - p.amount))", true))
                } else {
                    out.append((who, "−\(pts(p.amount))", false))
                }
            }
        }
        return out
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
