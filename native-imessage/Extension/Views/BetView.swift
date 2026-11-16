import SwiftUI

struct BetView: View {
    @EnvironmentObject var model: AppModel
    let locator: String
    @State private var card: NativeBet?
    @State private var serverClock: ServerClock?
    @State private var side = 0
    @State private var confidence = 0.5
    @State private var uncovered = false
    @State private var busy = false
    @State private var error: String?
    @State private var mutationIDs: [String: String] = [:]

    var body: some View {
        Group {
            if let card, model.isActive {
                switch card.content {
                case .sealed(let canVeto): sealed(card, canVeto: canVeto)
                case .unavailable: unavailable
                case .bet(let details): opened(card, details)
                }
            } else if error == nil { ProgressView().frame(maxWidth: .infinity).padding(40) }
            ErrorText(text: error)
        }
        .accessibilityIdentifier("bet.screen")
        .task(id: model.isActive) { if model.isActive { await poll() } }
        .onChange(of: model.activeTick) { _, _ in Task { await load() } }
        .onChange(of: model.isActive) { _, active in if !active { card = nil; uncovered = false } }
    }

    private var unavailable: some View {
        CardBox {
            Text("This card isn't available").font(.title2.bold())
            Text("It may be outside your membership period or no longer active. A forwarded card doesn't grant access.")
            Button("Groups and invitations") { model.go(.groups) }
        }
        .accessibilityIdentifier("bet.unavailable")
    }

    @ViewBuilder private func sealed(_ bet: NativeBet, canVeto: Bool) -> some View {
        Text("A secret bet about you").font(.largeTitle.bold())
        InkBubble(name: bet.card.subjectAlias)
            .accessibilityIdentifier("bet.sealed")
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            Text(deadline(bet.revealAt, prefix: "Reveals"))
                .font(.subheadline.monospacedDigit()).foregroundStyle(Theme.sub)
        }
        CardBox {
            Text("\(bet.card.bettorCount) friends are in").font(.headline)
            Text(bet.card.bettorInitials.joined(separator: " · ")).font(.subheadline)
        }
        Footnote(text: "Only locked metadata is available before the server reveals the question. Rubbing or changing your device clock can't reveal it early.")
        if canVeto {
            Button("Quietly veto this bet", role: .destructive) { Task { await mutate("v0Bets:veto", bet: bet) } }
                .frame(minHeight: 44)
                .disabled(busy)
                .accessibilityIdentifier("bet.veto")
            Footnote(text: "One tap removes it quietly. No card update or group announcement is sent.")
        }
    }

    @ViewBuilder private func opened(_ bet: NativeBet, _ details: BetDetails) -> some View {
        Text(bet.state == "provisional" ? "Awaiting the group" : "Called It").font(.largeTitle.bold())
        if details.canAnswer {
            RubToReveal(name: bet.card.subjectAlias, uncovered: $uncovered) { QuestionBubble(text: details.question) }
        } else {
            QuestionBubble(text: details.question).accessibilityIdentifier("bet.question")
        }
        if !details.canAnswer || uncovered {
            if details.canPick {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    Text(deadline(bet.cutoffAt, prefix: "Picks lock")).font(.subheadline.monospacedDigit())
                }
                InsetGroup {
                    ForEach(0..<2, id: \.self) { index in
                        Button { side = index } label: {
                            InsetRow(last: index == 1) {
                                Text(details.options[index]).foregroundStyle(.primary)
                                Spacer()
                                Image(systemName: side == index ? "checkmark.circle.fill" : "circle")
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(details.options[index])
                        .accessibilityAddTraits(side == index ? .isSelected : [])
                        .accessibilityIdentifier("bet.option.\(index)")
                    }
                }
                CardBox {
                    Text("Confidence: \(Int((confidence * 100).rounded()))%").font(.headline)
                    Slider(value: $confidence, in: 0...1, step: 0.01)
                        .accessibilityLabel("Confidence")
                        .accessibilityValue("\(Int((confidence * 100).rounded())) percent")
                        .accessibilityIdentifier("bet.confidence")
                    if let risk = details.myPick?.riskPoints { Text("Server-recorded risk: \(pts(risk)) points").font(.footnote) }
                }
                PrimaryButton(title: details.myPick == nil ? "Save pick" : "Update pick", busy: busy) {
                    Task { await mutate("v0Bets:pick", bet: bet, args: ["option": side, "confidence": confidence]) }
                }
                .accessibilityIdentifier("bet.savePick")
                Footnote(text: "One editable pick until cutoff. Scores and any risk/reward come only from the server's approved policy, never an estimated payout here.")
            } else {
                Text(bet.state == "locked" ? "Picks are locked. Waiting for reveal." : bet.state.capitalized)
                    .font(.headline).accessibilityIdentifier("bet.state")
                if let pick = details.myPick {
                    Text("Your pick: \(details.options[safe: pick.option] ?? "—") · \(Int(pick.confidence * 100))% confidence")
                        .accessibilityIdentifier("bet.savedPick")
                }
            }
            if ["revealed", "provisional", "finalized"].contains(bet.state) {
                positions(details)
                ProofView(betID: bet.betId, canUpload: details.canAnswer)
            }
            if details.canAnswer {
                Text("What happened?").font(.title2.bold())
                if let at = details.answerDeadline { Text(deadline(at, prefix: "Answer by")).font(.footnote) }
                ForEach(0..<2, id: \.self) { index in
                    PrimaryButton(title: details.options[index], color: Theme.verdict(index), busy: busy) {
                        Task { await mutate("v0Bets:answer", bet: bet, args: ["option": index]) }
                    }
                    .accessibilityIdentifier("bet.answer.\(index)")
                }
                Footnote(text: "Self-declare honestly. Proof is optional; upload it before answering. Your answer stays provisional through the server's challenge window.")
            }
            if let provisional = details.provisionalOutcome {
                Text("Provisional: \(details.options[safe: provisional] ?? "—")").font(.headline)
                if let at = details.challengeDeadline { Text(deadline(at, prefix: "Challenges close")).font(.footnote) }
            }
            if details.canChallenge {
                Button("Challenge this answer") { Task { await mutate("v0Bets:challenge", bet: bet) } }
                    .frame(minHeight: 44).disabled(busy).accessibilityIdentifier("bet.challenge")
            }
            if let outcome = details.outcome {
                CardBox {
                    Text("Final result: \(details.options[safe: outcome] ?? "—")").font(.title2.bold())
                    Text("Group points and streaks are calculated by the server.").font(.footnote)
                }
                PrimaryButton(title: "Prepare result card") { model.send(bet) }
                    .accessibilityIdentifier("bet.sendResult")
                Footnote(text: "This prepares a neutral update to this bet's Messages session. You tap Send. It doesn't silently edit a previously sent card or post in the background.")
            } else if bet.state != "voided" {
                SoftButton(title: "Prepare card update") { model.send(bet) }
                    .accessibilityIdentifier("bet.sendUpdate")
            }
        }
    }

    private func positions(_ details: BetDetails) -> some View {
        VStack(alignment: .leading) {
            SectionTitle(text: "Group picks")
            InsetGroup {
                ForEach(details.picks) { pick in
                    InsetRow(last: pick.id == details.picks.last?.id) {
                        Text(pick.alias)
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text(details.options[safe: pick.option] ?? "—")
                            Text("\(Int(pick.confidence * 100))% confidence").font(.footnote).foregroundStyle(Theme.sub)
                        }
                    }
                }
            }
        }
    }

    private func deadline(_ at: Double, prefix: String) -> String {
        let remaining = max(0, Int((at - (serverClock?.now() ?? at)) / 1000))
        return "\(prefix) \(clock(at)) · \(remaining / 3600):\(String(format: "%02d:%02d", remaining % 3600 / 60, remaining % 60))"
    }

    private func poll() async {
        while !Task.isCancelled && model.isActive {
            await load()
            var interval = 8.0
            if let card, let serverClock {
                let deadlines = [card.cutoffAt, card.revealAt].filter { $0 > serverClock.now() }
                if let next = deadlines.min() { interval = min(interval, max(0.3, (next - serverClock.now()) / 1000 + 0.2)) }
            }
            do { try await Task.sleep(for: .seconds(interval)) }
            catch { return }
        }
    }

    private func load() async {
        guard let token = model.token, model.isActive else { return }
        do {
            let next: NativeBet? = try await API.query("v0Bets:get", ["token": token, "locator": locator])
            guard model.token == token, model.isActive, !Task.isCancelled else { return }
            guard let next, next.groupId == model.linkedRoomId,
                  try model.locator(for: next.card).value == locator else { throw NativeError.invalidLink }
            let firstLoad = card == nil
            card = next
            serverClock = ServerClock(serverTime: next.serverTime)
            if firstLoad, case .bet(let details) = next.content, let pick = details.myPick {
                side = pick.option
                confidence = pick.confidence
            }
            error = nil
        } catch {
            card = nil
            self.error = error.localizedDescription
            model.handle(error)
        }
    }

    private func mutate(_ path: String, bet: NativeBet, args: [String: Any] = [:]) async {
        guard let token = model.token, !busy else { return }
        busy = true
        defer { busy = false }
        var args = args
        let fingerprint = path + String(data: (try? JSONSerialization.data(withJSONObject: args, options: .sortedKeys)) ?? Data(), encoding: .utf8)!
        let requestID = mutationIDs[fingerprint] ?? UUID().uuidString
        mutationIDs[fingerprint] = requestID
        args["token"] = token
        args["betId"] = bet.betId
        args["requestId"] = requestID
        do {
            let _: Ignored? = try await API.mutation(path, args)
            guard model.token == token else { return }
            mutationIDs.removeValue(forKey: fingerprint)
            await load()
        } catch {
            self.error = error.localizedDescription
            model.handle(error)
            if (error as? APIError)?.code == "CONFLICT" { await load() }
        }
    }
}
