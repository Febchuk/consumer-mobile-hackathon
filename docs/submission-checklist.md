# Submission checklist

Source: https://consumermobilehackathon.com/ and its Capy, Revyl and Convex pages. The site lists no submission form, rules page, video requirement or deadline. The fields below are the ones we expect. Confirm them against the real form and the kickoff rules.

## What the hackathon site says

- Build an iOS or Android app in one day and demo it live on a phone tonight.
- Capy, Revyl and Convex are marked "Required to win". Capy writes the app, Revyl runs it on a device and checks it, Convex is the backend.
- All code is written after 10:00 AM. The Capy page says to start from a new repository.
- Whop, Supermemory, Keiki, OpenAI and Candle are optional extras.

## Form fields, with drafted answers

**Project name:** Called It

**Tagline:** Bet on your friends. In the group chat.

**Short description:** A private betting game that looks like iMessage. Friends write bets about each other, the odds move, and the person it is about sees it as invisible ink until the reveal.

**Long description:**
Called It is a private friend-group game that feels like a group chat. Friends write bets about each other and send them as messages. There are three formats: Yes/No, Over/Under and This or That. Everyone stakes points, the odds are pool-based and move live, and bettors show as emoji tapbacks. The person a bet is about sees it under invisible ink with only their name visible, until the 5:00 PM reveal. Then they rub it away, see everyone's positions, and call what happened (honor system) or veto it. Payouts post in the chat. Group details shows the leaderboard and a dinner pot, and the groups list shows your total points, best rank and nemesis. In the real-world version you choose to share chat screenshots, exports and photos, and Apple's on-device model drafts bets on the phone. Only the bet text goes to Convex. In the demo today the suggestions are staged and the app reads no real chats. It also ships as a real iMessage app: a native Messages extension that inserts a neutral bet card into the conversation and opens a private view for each person. Built with Expo, SwiftUI and Convex, written by Capy agents, tested on a Revyl cloud iPhone.

**Live link:** https://reliable-kookabura-33.convex.site

**Repo:** https://github.com/mikunad/consumer-mobile-hackathon (branch capy/called-it-core, PR #1; the repo is public. Native extension in native-imessage/)

**Demo video:** TODO parent: not asked for on the site. Record a 60 to 90 second screen recording as a backup anyway.

**Team:** TODO parent: names, emails and GitHub handles. Known: mikunad (Mikun Adewole).

**Tech used:** Expo, React Native, Expo Router, TypeScript, SwiftUI Messages extension (MSMessagesAppViewController, XcodeGen), Convex (realtime queries, mutations, actions, cron, file storage), Anthropic API for staged AI drafts, Revyl, Capy. Planned for the real version: Apple Foundation Models on device.

**How we used Capy:** Capy agents wrote the app. A Captain thread ran parallel threads and subagents on cloud machines, each opening its own pull request, and ran the Revyl iOS builds.

**How we used Revyl:** iOS build on Revyl cloud runners, run on a cloud iPhone, plain-English tests in revyl/tests/. Results in revyl/results.md: 9 of 9 journeys completed at b2bd010. The swipe-back bug found in journey 8 was fixed and confirmed on a fresh standalone build at 83c90be. A pull-request profile for Revyl proof of changes is in .revyl/config.yaml.

**How we used Convex:** The whole backend. Realtime queries drive the chat and the odds, mutations handle stakes, declares and vetoes, an action calls the AI model, and file storage serves the web build.

**Sponsor extras:** None confirmed. TODO parent: Whop checkout is not in this version. Add OpenAI only if its key is in use (it is not).

**Screenshots:** docs/screenshots/ (seven web images at 390 by 844, plus four native Simulator images named native-*).

## Wording to keep honest

- For the iMessage app: Simulator flows are verified. On a real phone, verified means installed and showing in the drawer; say more only after pairing and delivery are checked.
- Say "staged" for the connect-your-context screen and the suggestion cards.
- Say the on-device model is the real-world design, not what runs today.
- Never say the app reads iMessage, SMS or calls. It does not.
- Say "friendly roasts you opted into". Do not describe it as anything harsher.
- The "Draft live with AI" button sends a staged sample chat to a hosted model. It is not on-device.

## Pre-submit checklist

- [ ] Live link loads on a phone on cellular, not only on venue wifi.
- [ ] The root link opens the new chat app, and /hackathon opens the old game.
- [ ] An invite link opens the join screen and the join works.
- [ ] Place one stake and see it post to the chat on a second phone.
- [ ] A bet about a friend shows as invisible ink to that friend.
- [ ] Reveal, rub, declare and veto work in the demo group (or use the replay).
- [ ] Demo replay and Restore work, and the real 5 PM snapshot exists.
- [ ] Admin passcode works. It is not in the README, docs, repo, results.md or the form.
- [ ] No API keys in the repo. Run `git grep -i -E "sk-|api_key|passcode"` and check the hits are only variable names.
- [ ] Test groups and test users (zz_ names) are not in the real demo group.
- [ ] Native: pair on the phone with the code from group details → Pair iMessage app, send one card to a second phone, and check the second phone sees only the neutral card.
- [ ] Don't call native message delivery between phones verified until that check has been done.
- [ ] revyl/tests/ and revyl/results.md are committed.
- [ ] Repo is public or shared as the form requires, and the final PR is merged by Mikun.
- [ ] Backup screen recording saved on the laptop.
- [ ] Submit before the deadline. TODO parent: confirm the exact time.
