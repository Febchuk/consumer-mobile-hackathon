import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { approvedPolicy, localDateAt, localInstant } from "./v0GamePolicy";
import { queueNotification } from "./v0Notifications";
import { activeMember, isBlocked } from "./v0Policy";

type Member = Awaited<ReturnType<typeof activeMembers>>[number];
const dayMs = 24 * 60 * 60_000;

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

export function nextTurnStart(timezone: string, now: number): number | null {
  const localDate = localDateAt(timezone, now);
  if (!localDate) return null;
  const today = localInstant(timezone, localDate, approvedPolicy.turnStartHour);
  if (today === null) return null;
  return now < today ? today : localInstant(timezone, localDate, approvedPolicy.turnStartHour, 1);
}

async function chooseSubject(ctx: QueryCtx, group: Doc<"v0Groups">, members: Member[], creatorId: Id<"v0Accounts">, preferred?: Id<"v0Accounts">) {
  const eligible: Member[] = [];
  for (const entry of members) {
    if (entry.account._id !== creatorId && !entry.account.noBets && !(await isBlocked(ctx, creatorId, entry.account._id))) eligible.push(entry);
  }
  if (preferred && eligible.some((entry) => entry.account._id === preferred)) return preferred;
  const lastSubjectAt = new Map<Id<"v0Accounts">, number>();
  for (const bet of await ctx.db.query("v0Bets").withIndex("by_group", (q) => q.eq("groupId", group._id)).collect()) {
    if (Number.isFinite(bet.createdAt)) lastSubjectAt.set(bet.subjectId, Math.max(lastSubjectAt.get(bet.subjectId) ?? -Infinity, bet.createdAt));
  }
  const waited = (entry: Member) => {
    const last = lastSubjectAt.get(entry.account._id);
    return last === undefined || last < entry.member.joinedAt ? -Infinity : last;
  };
  return eligible.sort((a, b) => (waited(a) === waited(b) ? 0 : waited(a) < waited(b) ? -1 : 1))[0]?.account._id ?? null;
}

async function chooseTurn(ctx: QueryCtx, group: Doc<"v0Groups">, members: Member[], afterId: Id<"v0Accounts"> | undefined, excludeId?: Id<"v0Accounts">, preferredSubject?: Id<"v0Accounts">) {
  let start = 0;
  if (afterId) {
    const rows = await ctx.db.query("v0Memberships").withIndex("by_group_account", (q) => q.eq("groupId", group._id).eq("accountId", afterId)).collect();
    const last = rows.sort((a, b) => b.joinedAt - a.joinedAt || b._creationTime - a._creationTime)[0];
    if (last) {
      const index = members.findIndex((entry) => entry.member.joinedAt > last.joinedAt || (entry.member.joinedAt === last.joinedAt && entry.member._creationTime > last._creationTime));
      start = index < 0 ? 0 : index;
    }
  }
  for (let offset = 0; offset < members.length; offset++) {
    const creatorId = members[(start + offset) % members.length].account._id;
    if (creatorId === excludeId) continue;
    const subjectId = await chooseSubject(ctx, group, members, creatorId, preferredSubject);
    if (subjectId) return { creatorId, subjectId };
  }
  return null;
}

async function clearTurnNotifications(ctx: MutationCtx, groupId: Id<"v0Groups">, localDate: string) {
  for (const step of ["assigned", "passed"]) {
    const item = await ctx.db.query("v0Outbox").withIndex("by_key", (q) => q.eq("key", `turn:${groupId}:${localDate}:${step}`)).unique();
    if (item && item.state !== "sent") await ctx.db.delete(item._id);
  }
}

export async function closeTurn(ctx: MutationCtx, turn: Doc<"v0Turns">, patch: { status: "created"; betId: Id<"v0Bets"> } | { status: "expired" }) {
  await ctx.db.patch(turn._id, patch);
  await clearTurnNotifications(ctx, turn.groupId, turn.localDate);
}

export async function passTurn(ctx: MutationCtx, group: Doc<"v0Groups">, turn: Doc<"v0Turns">, now: number) {
  if (turn.status !== "assigned" || turn.passedFromId !== undefined) return false;
  const members = await activeMembers(ctx, group._id);
  const next = members.length >= approvedPolicy.minActiveMembers ? await chooseTurn(ctx, group, members, turn.creatorId, turn.creatorId, turn.subjectId) : null;
  if (!next) return false;
  await clearTurnNotifications(ctx, group._id, turn.localDate);
  await ctx.db.patch(turn._id, { status: "passed", creatorId: next.creatorId, subjectId: next.subjectId, passedFromId: turn.creatorId, assignedAt: now });
  await ctx.db.patch(group._id, { lastCreatorId: next.creatorId });
  await queueNotification(ctx, { key: `turn:${group._id}:${turn.localDate}:passed`, accountId: next.creatorId, groupId: group._id, kind: "turn" });
  return true;
}

export async function advanceGroupTurn(ctx: MutationCtx, group: Doc<"v0Groups">, now: number): Promise<"assigned" | "passed" | "expired" | "waiting"> {
  const schedule = async (next: number | null, result: "assigned" | "passed" | "expired" | "waiting") => {
    await ctx.db.patch(group._id, { nextTurnAt: next !== null && next > now ? next : now + dayMs });
    return result;
  };
  const localDate = localDateAt(group.timezone, now);
  if (!localDate) return await schedule(null, "waiting");
  const at = (hour: number, dayOffset = 0) => localInstant(group.timezone, localDate, hour, dayOffset);
  const start = at(approvedPolicy.turnStartHour);
  const pass = at(approvedPolicy.turnPassHour);
  const end = at(approvedPolicy.turnEndHour);
  const tomorrow = at(approvedPolicy.turnStartHour, 1);
  if (start === null || pass === null || end === null) return await schedule(null, "waiting");
  if (now < start) return await schedule(start, "waiting");
  const turn = await ctx.db.query("v0Turns").withIndex("by_group_date", (q) => q.eq("groupId", group._id).eq("localDate", localDate)).first();
  if (!turn) {
    if (now >= end || (group.lastTurnDate !== undefined && group.lastTurnDate >= localDate)) return await schedule(tomorrow, "waiting");
    const members = await activeMembers(ctx, group._id);
    const choice = members.length >= approvedPolicy.minActiveMembers ? await chooseTurn(ctx, group, members, group.lastCreatorId) : null;
    if (!choice) return await schedule(tomorrow, "waiting");
    await ctx.db.insert("v0Turns", { groupId: group._id, localDate, creatorId: choice.creatorId, subjectId: choice.subjectId, status: "assigned", assignedAt: now, passAt: pass });
    await ctx.db.patch(group._id, { lastCreatorId: choice.creatorId, lastTurnDate: localDate });
    await queueNotification(ctx, { key: `turn:${group._id}:${localDate}:assigned`, accountId: choice.creatorId, groupId: group._id, kind: "turn" });
    return await schedule(now < pass ? pass : end, "assigned");
  }
  if (turn.status === "created" || turn.status === "expired") return await schedule(tomorrow, "waiting");
  if (now >= end) {
    await closeTurn(ctx, turn, { status: "expired" });
    return await schedule(tomorrow, "expired");
  }
  if (turn.status === "assigned" && turn.assignedAt < pass) {
    if (now < pass) return await schedule(pass, "waiting");
    if (await passTurn(ctx, group, turn, now)) return await schedule(end, "passed");
  }
  return await schedule(end, "waiting");
}
