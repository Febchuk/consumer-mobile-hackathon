# Called It for iMessage (native)

A Messages extension for Called It, plus a one-screen container app. The extension is SwiftUI hosted in an `MSMessagesAppViewController`. It talks to the Convex backend over its plain HTTP API with `URLSession`; there's no Convex SDK.

- `App/`: the container app "CalledIt Messages". It explains how to pair and links to the web app.
- `Extension/`: the Messages extension. The screens are pair, link room, home (room details and recent bets), new bet (with ✦ ideas), the bet view (sealed, take a side, rub-to-reveal verdict, result), and the board.
- `UITests/`: an XCUITest harness that drives the Simulator's Messages app. It opens Kate Bell's chat and the app drawer, then goes through the flows and saves screenshots to `$SHOTS_DIR`.

## Build

You need Xcode 26 (iOS 17+ deployment target) and XcodeGen (`brew install xcodegen`).

```bash
cd native-imessage
xcodegen generate
# Simulator. Ad-hoc signing is needed so the Keychain works in the extension.
xcodebuild -project CalledItMessages.xcodeproj -scheme CalledItMessages \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= build
```

To run it in the Simulator, install the built `CalledItMessages.app` (`xcrun simctl install booted <path>`). Then open Messages, open a conversation, tap **+**, and pick **Called It**.

## Install on an iPhone with a free Personal Team

1. On the phone, turn on Settings → Privacy & Security → Developer Mode, restart, and confirm.
2. Plug the phone in and trust the Mac.
3. Open `CalledItMessages.xcodeproj` in Xcode. Under Settings → Accounts, sign in with your Apple ID. Then select the **CalledItMessages** scheme and your phone, and press Run. `project.yml` sets automatic signing with team `6555P5TAV6`. With a different team, change `DEVELOPMENT_TEAM` and the bundle ids (`com.mikunad.calledit.messages` and `.ext`), then run `xcodegen generate` again.
   From the command line, once Xcode has the account: `xcodebuild -scheme CalledItMessages -destination 'id=<device id>' -allowProvisioningUpdates build`, then `xcrun devicectl device install app --device <id> <path to .app>`.
4. On the phone, go to Settings → General → VPN & Device Management and trust the developer certificate.
5. Free-team builds expire after 7 days.

## Pair

1. Open the web app at https://reliable-kookabura-33.convex.site. You're signed in there already.
2. Open your group, tap Details, then **Pair iMessage app**. You get a 6-character code that's valid for 10 minutes and works once.
3. In Messages, open Called It, then type the code or tap Paste, and tap **Pair**. The session token is saved only in this device's Keychain and is never logged.
4. Link the conversation to a room. You can pick one of yours, create one, or join one with an invite code. The link is saved on this device only, as a convenience. Your identity comes from the Keychain token, not from the conversation.

## Privacy

- A message URL holds only opaque ids: `calledit://bet?r=<room>&b=<bet>` or `calledit://board?r=<room>`.
- A bet card shows only "🔒 A bet about <name>", the reveal time and the bettors' emoji. It never shows the question, the options or the odds, in any field, image or accessibility label.
- The extension never reads your messages or contacts and never sends on its own: you always tap Send.

## What's verified

All of this was tested in Simulator Messages on iOS 26.5 against the live backend, with test accounts. The run covered pairing, linking a room, the home screen, new bet → insert → Send, tapping the bubble to open the bet view, the sealed subject view, rubbing to reveal and declaring, and the board. Physical iPhones need the Developer Mode step above.
