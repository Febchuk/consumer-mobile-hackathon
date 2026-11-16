# Revyl test run v2: Called It friend-group chat app on iOS

- **Date:** 2026-11-15, 3:35–3:47 PM PT
- **Build:** 01M7GRRNEX1RSRDVYYJR0M39D2 (Revyl version 572d8008-5ece-4d5f-b5cd-f498b2e446cc, commit b2bd010, Release simulator build)
- **Device:** Revyl cloud iPhone 16 (iOS simulator), portrait
- **Test user:** `@revyl_qa_2` 😎, group "QA Pair" (invite code `qapair282`). The real group "Mikun, Febe & Jill" was not touched.
- **Runner:** Revyl YAML tests in `revyl/tests/*.yaml`. We had no Revyl API key, so `revyl test run` was not used. Each step was run by hand on the Revyl cloud iPhone with Capy's phone control, with a screenshot at each assertion.
- **Seeding:** Only Convex CLI calls against QA Pair: `chat:demoRevealAt` (reset the reveal 1 h ahead before the run, then to "now" for journey 8), `chat:createBet` from zz_qa_a about revyl_qa_2 (60 on Yes) and `chat:stake` from zz_qa_b (40 on No). No dev, deploy or publish.

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | called-it-chat-join | PASS | Typed revyl_qa_2, picked 😎 through the emoji keyboard, tapped "I'm in", landed on "Let Called It read the room." |
| 2 | called-it-chat-context | PASS | Allowed Photos & screenshots, Continue → "Reading what you shared, on your phone…" → "Found 2 friends · 9 bet ideas" → See the bets → Groups list. |
| 3 | called-it-chat-join-group | PASS | Join → qapair282 → QA Pair chat opened. |
| 4 | called-it-chat-write-bet | PASS | Typed the question, picked zz_qa_a, "This or That", labels, the first side and 50, sent. Blue bubble plus "50 on Finishes i · Will zz_qa_a finish the boba toda…". Points 1,000 → 950. |
| 5 | called-it-chat-ai-idea | PASS | "✦ Ideas from your chats" → picked the first card → tray showed "Created by AI · edit anything" → sent. The bubble is labelled **"AI · Created by AI"** with a ✦ avatar, not the player's name. |
| 6 | called-it-chat-stake-sheet | PASS | Tapped another member's bubble → market sheet → No → "Call it · 100 on No". The sheet lists @you under No with 100, and the chat has the stake message. Points 900 → 800. |
| 7 | called-it-chat-sealed-bet | PASS | Ink bubble showed only the "@revyl_qa_2" pill, the 🐙 🦊 bettor reactions, and "Unlocks at 5:00 · 2 friends are in". Tapping it did nothing. |
| 8 | called-it-chat-reveal | PASS, with a gesture bug | Reveal set to now → header "The reveal is live. Rub the ink." → rubbed → bubble shows "About you" with 60% / 40% → tap → True / False sheet → True → chat shows "It was Yes. … 🦊 zz_qa_a +40". Rubbing with several quick swipes in a row popped back to the Groups list twice (bug 1). |
| 9 | called-it-chat-group-details | PASS | Header tap → sheet with "6 people · invite code qapair282", dinner pot 830, ranked leaderboard (revyl_qa_2 (you) 800), "Riding on you: 1 bet · 2 friends in · 100 pts". |

## Bugs and rough edges (iOS)

1. **Rub-to-reveal fights the native swipe-back gesture** (journey 8). Chained left-to-right swipes on the ink bubble triggered the stack's interactive pop and dropped me back to the Groups list twice. One swipe at a time worked. Disabling `gestureEnabled` on the chat route while the ink is rubbed would fix it.
2. **Context screen: the "Apple on-device model · only bet text leaves your phone" pill runs off the right edge** on iPhone 16 (393 pt) on both the read and "All read." screens. The text is cut after "leaves your".
3. **The market sheet stays open after "Call it"**. The stake lands (message and points update) but the sheet only closes by swiping it down.
4. **Market sheet chart still says "reveal 5:00"** after the reveal has happened, and "Unlocks at 5:00" stays in the ink caption. These are fixed strings, not the group's real reveal time.
5. **Tray typing:** the keyboard covers fields in the "This or That" tray. In my run, tapping the second label field after the first one's keyboard was up typed into the first field (layout shifts under the tap).
6. "Found 2 friends" on the context screen names @mikunad and @febe, who are not in the test group (it looks like mocked demo data).

No crashes. Fonts, ink texture, blue/grey bubbles and the AI ✦ avatar render correctly.

## Screenshots (Capy file ids; the phone only returns file ids)

| Journey | Step | File id |
|---|---|---|
| 1 | Join screen | file_01M7GS25ESE9P5Q1YV4V9AG97F |
| 1 | Username and emoji filled | file_01M7GS3JJEW8816TMYW5S5CCG8 |
| 1 | Context screen | file_01M7GS3ZWMY4BVQ6FEYWXQQ90G |
| 2 | Photos allowed | file_01M7GS4JGBWE9QDPCBQBBSW5XK |
| 2 | Reading… | file_01M7GS4W32KZCSSFJ4ZZKZJMNE |
| 2 | Found 2 friends · 9 bet ideas | file_01M7GS52PVZFEVQY3Y36MF3ZY6 |
| 2 | Groups list (empty) | file_01M7GS5E7HNQQEA9J5GE010FXX |
| 3 | Invite code typed | file_01M7GS689V41ZJFKWC37RBSZKX |
| 3 | QA Pair chat | file_01M7GS6EF0DTZRA8NWRZY7PJZ0 |
| 4 | Tray open | file_01M7GS6XAAKVYT0FRGM694BD4N |
| 4 | Bet composed | file_01M7GSAPZS3HHW6RB4E342EVJG |
| 4 | Bet and stake sent | file_01M7GSAZWVK4D0AYJMFSFGMTYB |
| 5 | Ideas cards | file_01M7GSBHFKEG4EGM158871GRQM |
| 5 | Idea picked | file_01M7GSBSNQ6ZAJQXE2BFCQ4EWW |
| 5 | AI bubble sent | file_01M7GSC6BV5FV3VC63W7P70MKX |
| 6 | Market sheet | file_01M7GSCRVYPDJERAN3R2QVSTVJ |
| 6 | No picked | file_01M7GSD2JP3CX1DJENNYZ3ANAR |
| 6 | Staked | file_01M7GSD9PR6H5X3B5HKZSKMMNM |
| 6 | Stake message in chat | file_01M7GSDRQYGMWHGPC726CZ22N5 |
| 7 | Sealed ink bubble | file_01M7GSEZTTE2XYHJGWD498A9EF |
| 7 | After tapping the ink | file_01M7GSFAS4AM82ZPD6291D7BE5 |
| 8 | Reveal is live | file_01M7GSFQJ1B47AS02JRZZB51E3 |
| 8 | Swipe-back bug (Groups list) | file_01M7GSGS1RFWV1WP5F3Q800J57 |
| 8 | Ink rubbed away | file_01M7GSNWPWTRFAP3D5P0SKDMBY |
| 8 | True / False sheet | file_01M7GSP5ET3M2FR6Q0AWYRYFYV |
| 8 | True picked | file_01M7GSPK96JHS1MWDTY3RQMHYG |
| 8 | "It was Yes" message | file_01M7GSPVW9JZ9D9VB0T07TSHCT |
| 9 | Group details | file_01M7GSQ58MTQ6QPR116BQH12V6 |

## Status note (added 4:32 PM PT; the run above is unchanged)
- This run covers build 01M7GRRNEX1RSRDVYYJR0M39D2 at commit b2bd010. The steps were executed by hand on the Revyl cloud iPhone, not by Revyl's own runner, which needs REVYL_API_KEY. Results for later commits (7fb596e, 1746d51, 4feab75) are not covered by this run.
- Findings changed in code since then, NOT yet rechecked on device:
  - Swipe-back during rub (journey 8): gestureEnabled is now false on the chat route (7fb596e). Native rebuild required.
  - Stale "5:00" labels: they now read the group's reveal time (7fb596e).
  - Market sheet stays open after staking: it now closes (7fb596e).
  - Context pill clipping: the text now wraps (7fb596e).
  - Onboarding friends hardcoded: it now uses real group members (77837f7).
- Still open: This-or-That label typing goes to the wrong field while the keyboard is up (bug 5).
