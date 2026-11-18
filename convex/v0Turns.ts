import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { approvedPolicy, localDateAt, localInstant } from "./v0GamePolicy";
import { activeMember, isBlocked } from "./v0Policy";

export async function activeMembers(ctx: QueryCtx, groupId: Id<"v0Groups">) {
  const result: { member: Doc<"v0Memberships">; account: Doc<"v0Accounts"> }[] = [];
  for (const member of await ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect()) {
    if ((await activeMember(ctx, groupId, member.accountId))?._id !== member._id) continue;
    const account = await ctx.db.get(member.accountId);
    if (account && account.deletedAt === undefined) result.push({ member, account });
  }
  return result.sort((a, b) => a.member.joinedAt - b.member.joinedAt || a.member._creationTime - b.member._creationTime);
}

export function turnEndsAt(group: Doc<"v0Groups">, turn: Doc<"v0Turns">) {
  return localInstant(group.timezone, turn.localDate, approvedPolicy.turnEndHour);
}

export async function currentTurn(ctx: QueryCtx, group: Doc<"v0Groups">, member: Doc<"v0Memberships">): Promise<Doc<"v0Turns"> | null> {
  const localDate = localDateAt(group.timezone, Date.now());
  if (!localDate) return null;
  const turn = await ctx.db.query("v0Turns").withIndex("by_group_date", (q) => q.eq("groupId", group._id).eq("localDate", localDate)).unique();
  if (!turn || !Number.isFinite(turn.assignedAt) || !Number.isFinite(turn.passAt) || turn.assignedAt > Date.now() || turn.creatorId === turn.subjectId) return null;
  const creator = await ctx.db.get(turn.creatorId);
  const subject = await ctx.db.get(turn.subjectId);
  if (!creator || creator.deletedAt !== undefined || !subject || subject.deletedAt !== undefined || subject.noBets) return null;
  const creatorMember = await activeMember(ctx, group._id, creator._id);
  const subjectMember = await activeMember(ctx, group._id, subject._id);
  if (!creatorMember || !subjectMember || [member, creatorMember, subjectMember].some((row) => row.joinedAt > turn.assignedAt || (row.joinedAt === turn.assignedAt && row._creationTime >= turn._creationTime))) return null;
  if (await isBlocked(ctx, creator._id, subject._id) || await isBlocked(ctx, member.accountId, creator._id) || await isBlocked(ctx, member.accountId, subject._id)) return null;
  return turn;
}
