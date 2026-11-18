import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { recapLateLimitMs, recapWeek } from "./v0GamePolicy";
import { queueNotification } from "./v0Notifications";
import { activeMembers } from "./v0Turns";

const dayMs = 24 * 60 * 60_000;

export async function advanceGroupRecap(ctx: MutationCtx, group: Doc<"v0Groups">, now: number): Promise<"sent" | "skipped" | "waiting"> {
  const week = recapWeek(group.timezone, now);
  if (!week) {
    await ctx.db.patch(group._id, { nextRecapAt: now + dayMs });
    return "waiting";
  }
  await ctx.db.patch(group._id, { nextRecapAt: week.nextAt });
  if (now - week.endsAt >= recapLateLimitMs || group.createdAt >= week.endsAt) return "skipped";
  const recaps = await ctx.db.query("v0Recaps").withIndex("by_group", (q) => q.eq("groupId", group._id)).collect();
  if (recaps.some((recap) => recap.localDate === week.localDate)) return "skipped";
  const startsAt = Math.max(week.startsAt, ...recaps.map((recap) => Number.isFinite(recap.endsAt) ? recap.endsAt : Number.MAX_SAFE_INTEGER));
  if (startsAt >= week.endsAt) return "skipped";
  const ledger = await ctx.db.query("v0Ledger").withIndex("by_group", (q) => q.eq("groupId", group._id)).collect();
  if (!ledger.some((entry) => entry.accountId !== undefined && entry.createdAt >= startsAt && entry.createdAt < week.endsAt)) return "skipped";
  await ctx.db.insert("v0Recaps", { groupId: group._id, startsAt, endsAt: week.endsAt, createdAt: now, localDate: week.localDate });
  for (const { member, account } of await activeMembers(ctx, group._id)) {
    if (member.joinedAt < week.endsAt) await queueNotification(ctx, { key: `recap:${group._id}:${week.localDate}:${account._id}`, accountId: account._id, groupId: group._id, kind: "recap" });
  }
  return "sent";
}
