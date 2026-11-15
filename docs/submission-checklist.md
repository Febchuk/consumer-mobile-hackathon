# Submission checklist

Source: https://consumermobilehackathon.com/ and its Capy, Revyl and Convex pages (fetched today). The site does not list a submission form or a rules page. These are the fields we expect. Confirm against the real form and the kickoff rules.

## What the hackathon site says

- Build an iOS or Android app in one day and demo it live on a phone tonight.
- Capy, Revyl and Convex are marked "Required to win": Capy writes the app, Revyl runs it on a device and checks it, Convex is the backend.
- All code is written after 10:00 AM. Start from a new repository (the Capy page says to tick "Add a README").
- Whop, Supermemory, Keiki, OpenAI and Candle are optional extras.
- No video, deck or deadline is stated on the site.

## Form fields, with drafted answers

**Project name:** Called It

**Tagline:** A prediction market for the people in the room.

**Short description (one line):** Bet points on what happens at the hackathon. Odds move like a market, results reveal like Wordle.

**Long description:**
Called It is a social prediction market. Players join with a username and an emoji and get 1,000 points. Every hour a Drop of six yes/no or over/under bets lands, all about the room. Players stake points, and the odds shown as percents move with every stake. Winners split the pot, and a streak multiplier adds 10% per consecutive Drop, up to 2x. Results come as a story-style reveal with Wordle-like CALLED tiles. A /tv view puts the odds and leaderboard on a projector, private groups let friends make and settle their own bets, and a finals live counter settles a bet from how many times someone says "agent". The host can paste a transcript into an admin screen and an AI model drafts six bets to edit and approve. It runs as one Expo codebase on iPhone and web, with Convex as the realtime backend.

**Live link:** https://reliable-kookabura-33.convex.site

**Repo:** https://github.com/mikunad/consumer-mobile-hackathon (TODO parent: confirm which branch or repo to submit, and make sure it is public if required)

**Demo video:** TODO parent: the site does not ask for one, but record a 60 to 90 second screen recording as a backup anyway.

**Team:** TODO parent: names, emails, GitHub handles. Known: mikunad (Mikun Adewole).

**Tech used:** Expo, React Native, Expo Router, TypeScript, Convex (realtime queries, mutations, actions, cron, file storage), Anthropic or OpenAI API for bet drafts, Whop sandbox (in progress), Revyl, Capy.

**How we used Capy:** Capy agents wrote the app. A Captain thread ran parallel threads and subagents on cloud machines, each opening its own pull request, and built the iOS app through Revyl.

**How we used Revyl:** iOS build on Revyl cloud runners, run on a cloud iPhone, with plain-English tests in revyl/tests/. TODO parent: add the pass count and link results.md.

**How we used Convex:** The full backend. Realtime queries drive every screen and /tv, mutations handle stakes and settlement, an action calls the AI model, a cron prepares each Drop, and file storage serves the web build.

**Sponsor extras:** Whop sandbox checkout (in progress, TODO parent: confirm status). OpenAI credits, only if the OpenAI key is the one in use. Say which.

**Screenshots:** docs/screenshots/ (six images).

## Pre-submit checklist

- [ ] Live link loads on a phone on cellular, not only on venue wifi.
- [ ] /tv loads full screen on the projector laptop.
- [ ] /qr scans and opens the live site. Scan it with a phone that is not ours.
- [ ] Join with a fresh username works and gives 1,000 points.
- [ ] Place one stake and see the odds move on /tv.
- [ ] Reveal story opens for a settled Drop.
- [ ] Admin passcode works, and it is not in the README, the docs, the repo, or the form.
- [ ] No API keys in the repo. Run `git grep -i -E "sk-|api_key|passcode"` and check the hits are only variable names.
- [ ] Test users and test bets removed from the live data (names like zz_, test-, revyl).
- [ ] Finals counter bet exists, shows 0, and +1 works from admin.
- [ ] Drop 5 (6 PM finals) is created and its bets are approved.
- [ ] AI draft works with the key set (try one paste before stage).
- [ ] README TODOs resolved: Whop status, Revyl pass count.
- [ ] revyl/tests/ and results.md are committed.
- [ ] Repo is public or shared as the form requires, and the PR with the final code is merged by Mikun.
- [ ] Demo video recorded as a backup (even if not required).
- [ ] Submit before the deadline. TODO parent: confirm the exact time. The brief said 5:15 PM PT for this pack and 6:00 PM for submission.
