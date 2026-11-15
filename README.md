# Called It
Prediction markets for what's going to happen to your friend group.

Every hour a new drop of bets lands for everyone at once. Stake points, odds come from the pool (parimutuel), long shots pay the most, and streaks boost payouts.

- App: Expo Router + TypeScript (`src/app`), web export served from Convex HTTP actions.
- Backend: Convex (`convex/`): data, live odds, settlement, hourly round prep.
- Live: https://reliable-kookabura-33.convex.site (`/tv` projector, `/admin` passcode = Convex env var `ADMIN_PASSCODE`).

```bash
npm install
npm run deploy:convex   # push Convex functions (needs CONVEX_DEPLOY_KEY)
npm run publish:web     # export web and upload it to Convex hosting
```
