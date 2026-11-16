import SwiftUI
import UIKit

struct PairView: View {
    @EnvironmentObject var model: AppModel
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        HStack(spacing: 10) {
            CIAvatar(size: 40)
            Text("Pair Called It").font(.system(size: 28, weight: .bold))
        }
        Text("On the web app, open your group, tap Details, then \"Pair iMessage app\". Type the 6-letter code here. It works once and lasts 10 minutes.")
            .font(.system(size: 15)).foregroundStyle(Theme.sub)
        CardBox {
            TextField("ABC123", text: $code)
                .font(.system(size: 30, weight: .bold, design: .monospaced))
                .multilineTextAlignment(.center)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .padding(.vertical, 8)
                .accessibilityIdentifier("pairCode")
                .onChange(of: code) { _, value in
                    let clean = String(value.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(6))
                    if clean != value { code = clean }
                }
            PasteButton(payloadType: String.self) { strings in
                Task { @MainActor in code = strings.first ?? "" }
            }
            .buttonBorderShape(.capsule)
            .tint(Theme.accent)
            .frame(maxWidth: .infinity)
            .accessibilityIdentifier("pastePairCode")
        }
        PrimaryButton(title: "Pair", busy: busy) { Task { await pair() } }
            .opacity(code.count == 6 ? 1 : 0.5)
            .disabled(code.count != 6)
            .accessibilityIdentifier("pairButton")
        ErrorText(text: error)
        Button("Open the web app") { model.openWeb() }.font(.system(size: 17))
        Footnote(text: "Your sign-in stays in this device's Keychain. Called It never reads your messages or contacts.")
    }

    private func pair() async {
        busy = true
        defer { busy = false }
        do {
            let device = "iMessage · " + UIDevice.current.model
            guard let result: PairResult = try await API.mutation("ext:redeemPair", ["code": code, "device": device]) else {
                error = "Pairing failed."
                return
            }
            error = nil
            await model.signedIn(result)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
