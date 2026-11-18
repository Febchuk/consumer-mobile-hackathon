# Called It

A private prediction game for invited groups of friends, played inside iMessage.

This is the V0 integration branch. V0 is iPhone and iMessage only: there is no Android app and no web app. Called It does not read chats, photos or contacts.

## What is here

| Path | What it is |
| --- | --- |
| `native-imessage/` | The iPhone app and its Messages extension (SwiftUI, built with XcodeGen). See [native-imessage/README.md](native-imessage/README.md). |
| `convex/` | The backend. Functions from the hackathon demo are retired and always refuse; V0 functions start with `v0`. See [convex/V0_MIGRATION.md](convex/V0_MIGRATION.md). |
| `web/index.html` | One static page that says Called It lives in iMessage and how to get it. No scripts, no links, no network requests. |
| `tests/` | Backend tests, the local-backend lane, and the QA harness. |
| `docs/v0-rules.md`, `docs/release/` | The V0 rules and the release runbook, including the privacy draft. |
| `release/` | Offline release-candidate tooling. |

The hackathon demo app (Expo, React Native and web) is not on this branch. It remains on `main`.

## The web page

`web/index.html` is a single self-contained file that any static host can serve. It carries no install link: V0 is an invited TestFlight beta.

Card links that an Android or SMS recipient opens are answered by the backend itself (`convex/v0Web.ts`), which serves its own neutral page at `/` and `/c/<id>` and shows an install link only when `V0_INSTALL_URL` is set to an approved TestFlight or App Store address.

## Checks

```bash
npm ci --ignore-scripts
npm run typecheck
npm run lint                 # eslint, then scripts/check-static.mjs
npm run test:backend         # in-memory backend inside a network namespace with no routes (Linux)
npm run test:local-backend   # checksum-pinned local Convex backend on loopback
```

`scripts/check-static.mjs` fails if the web page gains a script, a link or a claim about reading shared material, or if any file outside the tests names a Convex deployment address.

## Configuration

No file in this repository names a deployment. The native app reads its backend and card addresses from build settings that are empty by default, and its configuration fails without them (see [native-imessage/README.md](native-imessage/README.md)). `npm run deploy:convex` runs `convex dev --once` against whatever deployment your own untracked `.env.local` selects, and asks when there is none.

Tests never talk to a hosted deployment, and nothing here deploys.
