# Revyl test run: Called It on iOS

- **Date:** 2026-11-15, 2:48–3:01 PM PT
- **Build:** 01M7GNX00SBHHDZD8ZR4Q6PDSF (Revyl version a0fbe8d0-e86d-4f58-b727-7c2598356548, commit a61ef74, Release simulator build)
- **Device:** Revyl cloud iPhone 16 (iOS simulator), portrait
- **Test user:** `@revyl_qa_1` (🦖). Usernames starting with "revyl" are hidden from boards.
- **Runner:** The tests below use Revyl's YAML format (`revyl/tests/*.yaml`). We had no Revyl API key, so `revyl test run` couldn't be used. Instead, each step was run by hand on the Revyl cloud iPhone through Capy's phone control, with a screenshot at every assertion.

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | called-it-join | PASS | Picked @revyl_qa_1 and 🦖, tapped Join, saw the "Time to call it." drop announcement, then landed on Today with 1,000 points. |
| 2 | called-it-place-bet | PASS, with workaround | The market page opens. Staking from it is **blocked by a bug**: the amount resets to 100 every 10 s (details below). Staked 10 on YES for "Is dinner pizza tonight?" from the Today card's stake sheet instead. The card shows "You called YES · 10 · LATE, wins 19" and points went 1,000 → 990. |
| 3 | called-it-board | PASS | "The Board" shows summary tiles and a ranked table (@febe, @mikunad, @febe_c35). The revyl user is hidden as designed. |
| 4 | called-it-admin-and-group-settle | PASS | Opened `calledit://admin`, entered passcode `hotdrop26`, and saw drops and their bets listed. Nothing was settled there. Then Me → created group "Revyl QA" → added "Revyl QA: does this test pass?" → staked 50 on Yes → tapped "Yes happened". The bet shows CALLED · YES · "You called YES · 50 +0". |
| 5 | called-it-reveal | PASS | Today showed "Drop 1 results are in. Tap to reveal". The story went through 3 cards: the room's call, what happened, and the CALLED tiles card ("Clean sweep.", 1/1 called, "Copy my drop"). Done returned to Today and the banner was gone. |

## Bugs found

1. **The market page stake amount resets every 10 s** (`src/app/bet/[id].tsx`). `useQueryNow()` changes the `now` arg every 10 s. `useQueries` then returns `undefined` while it refetches, so `{d ? <Body/> : null}` unmounts and remounts Body. That resets StakePanel's amount and side and closes the keyboard. You can't type a custom amount and confirm on the market page.
2. **The iOS number pad covers the stake input and the "Call it" button** in the market page panel and the Today stake sheet. The number pad has no Done key, so the only way out is tapping the sheet title.
3. **The Me screen keyboard covers the "New group" field and the Create button.** There's no keyboard avoidance, so you can't see what you type.
4. **Admin screen:** the "Admin" title sits under the status bar (no top safe-area inset), and there's no way to navigate back to the app.
5. **Reveal card copy mismatch:** it says "1 PLAYER · 50 PTS" but also "2 BETS PLACED" for a bet with a single stake.

## Screenshots (Capy file ids)

The phone screenshots came back as Capy thread file ids, not files on disk. They're attached to the CONS-2 report.

| Step | File id |
|------|---------|
| Join screen | file_01M7GPC3RVVMFAR5QTRGF6C1D3 |
| Join filled in | file_01M7GPCNNFAM9EPV7MWHENDCZX |
| Drop announcement | file_01M7GPCXKYCBG228S1VCXGT90B |
| Today | file_01M7GPD8NM6A7WARMR8P4VGP1X |
| Market page | file_01M7GPDN357DPNAZWWJA9JBBHK |
| Stake sheet at 10 | file_01M7GPNACGFSYWPAJFYP16XFKT |
| Position after stake | file_01M7GPP1RRFM8H826EZ3WYTNNB |
| Board | file_01M7GPPCRJWNS86D73PT1PAZ2A |
| Admin list | file_01M7GPQAKMCZM1F3VX62TW5EVW |
| Me | file_01M7GPQRB47QT5VV0HASSGYX0C |
| Group with bet | file_01M7GPZXAQJ0P0DXEB7JB1XHDB |
| Group stake placed | file_01M7GQ0M4AE5PX05RJRHAT9H51 |
| Group bet settled | file_01M7GQ0Z6S0YHDTX7ZGYEYZABW |
| Results-are-in banner | file_01M7GQ1ZV2R4V17KS33NTWDTAB |
| Reveal 1 | file_01M7GQ2DCD966XKH10DHJXRN01 |
| Reveal 2 | file_01M7GQ2KV02C9HKRPNR4E5RK44 |
| CALLED card | file_01M7GQ2TXYA8NSTFYE3FZAEP3E |
