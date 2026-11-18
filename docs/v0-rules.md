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
