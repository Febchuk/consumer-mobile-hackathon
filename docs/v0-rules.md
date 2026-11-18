# Called It V0 rules

Approved by Febe on November 17, 2026. Policy version `v0-policy.3`.

These are the rules the backend enforces. Every number below lives in one place in the code, `convex/v0GamePolicy.ts`, and the backend reads it from there. Change a rule there and here together, and give the policy a new version.

## 1. Scoring

- **Confidence, not stakes.** You pick an answer and say how sure you are, from 1% to 100%. Nobody puts points at risk.
- **Points for a correct pick:** 100 × confidence. A 70% pick earns 70. A wrong pick earns 0.
- **Streak:** the number of correct picks you have made in a row in one group. A wrong pick resets it to 0. A bet you did not pick on, or a bet that was voided, leaves it alone.
- **Streak bonus:** +10% for each correct pick in a row after the first, capped at double. Your second correct pick in a row earns ×1.1, your third ×1.2, and your eleventh and later ×2.
- **Rounding:** to the nearest whole point, halves up, after the streak bonus.
- **Ties on the board:** the same points share a rank and are listed by name.
- **Each group is separate.** Points and streaks in one group never change another group.

**Wrong-pick penalty: off.** The approved rule is reward-only. With no penalty, 100% confidence is always the best choice. The alternative Febe was offered is "a wrong pick loses half its confidence points, and a balance never goes below 0". It is built and tested but switched off. To switch it on, change `wrongPickPenaltyFraction` in `convex/v0GamePolicy.ts` from `0` to `0.5` and give the policy a new version.

## 2. Windows

- **Picks:** you can pick until the reveal. A pick is final the moment you confirm it.
- **Answer:** the subject has 24 hours after the reveal to answer.
- **Challenge:** the group has 1 hour after the subject answers to challenge.

## 3. Reveal time

- **Default:** 8:00 PM in the group's timezone, the same day, or the next day if it is already past 8.
- **Custom:** the creator can pick a different time for one bet, at least 10 minutes and at most 7 days ahead.

## 4. Creator and turn rotation

- **Who creates:** only the member whose turn it is. One bet per group per day.
- **Whose turn:** members take turns in the order they joined. The turn starts at 8:00 AM group time.
- **Who the bet is about:** the app names the subject: the eligible member who has gone longest without being one, never the creator.
- **Noon pass:** if the creator has not sent a bet by 12:00 noon, the turn passes once to the next member. The creator can also pass earlier. If nobody creates by 8:00 PM, there is no bet that day.
- **Who is skipped as subject:** anyone with "no bets about me" on, anyone the creator has blocked or been blocked by, anyone who left or deleted their account.
- **Who is skipped as creator:** only people who left or deleted their account.
- **Small groups:** a group needs at least 3 active members to get a turn.

## 5. Shared goal

- **Who sets it:** any member proposes a name and a points target.
- **Who confirms it:** it becomes active when more than half of the active members confirm it. The proposer counts as one.
- **How many:** one active goal per group at a time.
- **Progress and reward:** progress is the points the whole group has earned since the goal became active. Points only: no money, no prize, no individual payout.

## 6. Joining, challenges and timeouts

- **Joining a group:** only by accepting an invitation sent to your phone number. Opening or receiving a card never adds you. Invitations expire after 7 days.
- **Majority challenge:** if more than half of the people who picked on a bet challenge the answer within the hour, the bet is voided. Otherwise the subject's answer stands when the hour ends.
- **No answer:** the bet is voided 24 hours after the reveal. Nobody scores and streaks do not change.
- **Proof photos and voice notes:** cut from V0.

## 7. Notifications and other decisions

- **Weekly recap:** Sunday 6:00 PM group time, covering the previous seven days, sent once to members who have notifications on.
- **Result notification:** sent to the subject and everyone who picked, when the bet's result becomes final.
- **AI suggestions:** off for V0. Ideas come from built-in templates and the group's own past bets.
- **Reports:** a report is stored and reviewed by a named person within 24 hours.
- **Old demo accounts and points:** not carried over. Everyone verifies a phone number and starts at 0.
- **New member:** sees only bets created after they joined. No automatic starter bet.
- **Android and SMS:** a neutral "open in Called It on iPhone" message only.

## Decided during build

The approved rules do not cover these. Each was decided the conservative way while building, and Febe can overrule any of them.

### Bet creation

1. **The 10-minute minimum applies only to a custom reveal time.** A bet sent at 7:55 PM with no custom time still reveals at 8:00 PM that evening.
2. **A reveal time the app sends is always treated as custom,** even when it equals the default, so it must be 10 minutes to 7 days ahead.
3. **A member whose turn it is not is refused with "forbidden",** and nothing is saved. The same answer is given when the group has fewer than 3 active members.
4. **The 3 active members are counted when the bet is sent,** not only when the turn was assigned. A deleted account does not count.
5. **Creation is also limited to 10 bets per person per hour** across all their groups, as an abuse bound.
6. **A retried send returns the bet already created.** It never creates a second one, even if the retry arrives after 8:00 PM.

### Daily turn

7. **Tomorrow's turn goes to the member after whoever last held today's turn,** counting a pass. Nobody creates two days running because someone else missed a morning.
8. **A turn can be passed once, by anyone or by the clock.** The member it passed to cannot pass it again. If nobody else can take it, it stays with the first creator until 8:00 PM.
9. **When a turn passes, the subject stays the same** unless the new creator is that subject or is blocked with them. Then the app names a new subject by the same rule.
10. **"Gone longest without being the subject" counts bets actually sent about you in this group** since you last joined. A turn that produced no bet does not count. Members who have never been the subject go first, in join order.
11. **A creator with nobody eligible to be their subject is skipped** for the day. If no creator and subject pair exists, the group gets no turn that day.
12. **A turn that starts late still starts,** as long as it is before 8:00 PM: for example when the group gets its third member during the day, or after an outage. A turn that starts at or after noon is not passed by the clock; its creator can still pass it by hand.
13. **A new group's first turn check is the next 8:00 AM group time.** A group that reaches 3 members later that day gets its turn then.
14. **If today's creator or subject leaves the group, today's turn ends** and there is no bet that day. This was already how leaving worked. Deleting an account does the same.
15. **The turn notification goes only to the creator,** and to the new creator when it passes. One that has not been delivered yet is withdrawn when the turn passes, the bet is sent, the day ends, or the creator or subject leaves. It is checked again at the moment of delivery.
16. **One turn per group per local calendar date.** If a group's timezone changes, the new local date can get its own turn, but no date ever gets two.
17. **A group whose timezone the server cannot read gets no turns** until it is corrected.

### Challenges and results

18. **A challenge is decided once, when the hour ends.** A bet is not voided early, even if a majority has already challenged.
19. **Who counts:** people whose pick on that bet is still standing when the hour ends and who are still in the group. The subject never counts. A member who did not pick can still send a challenge, but it does not count.
20. **A member who left counts for nothing.** Their pick leaves the total and their stored challenge is ignored, so they can neither help void a bet nor dilute the people who stayed. Once the hour has ended the count is fixed: a bet whose hour is over is settled before anyone's departure, block or account deletion takes effect.
21. **A tie lets the answer stand,** because the rule says "more than half". If nobody picked, the answer stands and nobody scores.
22. **An answer given just before the 24-hour limit still gets its full hour** of challenge time. The no-answer timeout does not void an answered bet.
23. **If the bet's creator left the group, the reveal notification still goes** to the subject and the remaining pickers, and the bet plays out normally. Before, it was silently dropped, so the subject might never answer. It is still not sent when the creator's account was deleted (the bet is removed) or when the creator and subject have blocked each other (the bet is voided).
24. **A bet whose stored answer cannot be read is voided** once the answer and challenge windows have both passed, so it cannot stay open forever.

### Scoring and the ledger

25. **Points are credited in the same step that makes the result final,** once. Every scored pick gets a ledger line, including a wrong pick (0 points), so the history shows the streak ending.
26. **The streak bonus applies to the pick that extends the streak.** The first correct pick pays ×1.0, the second in a row ×1.1, and so on up to ×2.
27. **Halves round up exactly.** 38.5 becomes 39 even where the computer's arithmetic would land a hair under.
28. **A member who left before the result became final is not scored.** Leaving cancels their open picks. They keep the points they had, and rejoining starts a new balance at 0, as before.
29. **A stored pick that is not a valid pick is not scored:** an answer other than the two choices, or a confidence outside 1% to 100%.
30. **The result notification goes to the subject and to everyone whose pick was scored, right or wrong.** Members who did not pick get none. A voided bet sends no result notification.
31. **If the wrong-pick penalty is ever switched on,** the loss is rounded the same way, it never takes a balance below 0, and the ledger records the amount actually taken.
