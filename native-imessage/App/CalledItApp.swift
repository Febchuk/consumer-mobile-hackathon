import SwiftUI

@main
struct CalledItApp: App {
    var body: some Scene {
        WindowGroup {
            ContainerView()
                .preferredColorScheme(.light)
        }
    }
}

struct ContainerView: View {
    private let web = URL(string: "https://reliable-kookabura-33.convex.site")!

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Called It")
                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                Text("Bet on your friends, right inside iMessage. The friend a bet is about can't read it until the reveal, then they uncover it and say what really happened.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                step(1, "Open Called It on the web and sign in.")
                step(2, "Open your group, tap Details, then \"Pair iMessage app\". You get a 6-letter code that lasts 10 minutes.")
                step(3, "In Messages, tap the + button, choose Called It, and type the code.")
                step(4, "Link the chat to your group, then tap New bet. You always tap Send yourself.")
                Link(destination: web) {
                    Text("Open the web app")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(RoundedRectangle(cornerRadius: 14).fill(Color(red: 0.42, green: 0.67, blue: 0.39)))
                        .foregroundStyle(.white)
                }
                Text("iMessage apps can't post on their own, read your messages, or see your contacts.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(24)
        }
        .background(Color(.systemGroupedBackground))
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)")
                .font(.system(.headline, design: .rounded))
                .frame(width: 30, height: 30)
                .background(Circle().fill(Color(red: 0.89, green: 0.95, blue: 0.88)))
            Text(text).font(.body)
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
    }
}
