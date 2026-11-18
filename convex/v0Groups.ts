import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Goal, GroupSummary, Recap, Turn } from "./v0Contract";
import { activeMember, canReadBet, fail, isBlocked, once, phoneHash, policyStatus, rateLimit, requireMember, requireSession } from "./v0Policy";
import { approvedPolicy, localDateAt } from "./v0GamePolicy";
import { validateCandidate } from "./v0Safety";
import { activeMembers, currentTurn, nextTurnStart, passTurn as passTurnTo, turnEndsAt } from "./v0Turns";

function summary(group: Doc<"v0Groups">, member: Doc<"v0Memberships">): GroupSummary {
  return { id: group._id, name: group.name, timezone: group.timezone, alias: member.alias, points: member.points, streak: member.streak };
}

function conversationKey(value: string) {
  if (!value.trim() || value.length > 256 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) fail("INVALID_INPUT", "Choose a valid conversation.");
  return value;
}

export const create = mutation({
  args: { token: v.string(), name: v.string(), timezone: v.string(), requestId: v.string() },
  handler: async (ctx, { token, name, timezone, requestId }) => {
    const { account } = await requireSession(ctx, token);
    const cleanName = name.trim();
    if (!cleanName || name.length > 160 || cleanName.length > 80 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(name) || !timezone || timezone.length > 100) fail("INVALID_INPUT", "Enter a group name and timezone.");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    } catch {
      fail("INVALID_INPUT", "Choose a valid timezone.");
    }
    const result = await once(ctx, account._id, "groups.create", requestId, { name, timezone }, async () => {
      await rateLimit(ctx, `groups.create:${account._id}`, 10, 3_600_000);
      const now = Date.now();
      const groupId = await ctx.db.insert("v0Groups", { name: cleanName, timezone, creatorId: account._id, createdAt: now, nextTurnAt: nextTurnStart(timezone, now) ?? Number.MAX_SAFE_INTEGER });
      const membershipId = await ctx.db.insert("v0Memberships", { groupId, accountId: account._id, joinedAt: now, alias: account.displayName, points: 0, streak: 0 });
      return summary((await ctx.db.get(groupId))!, (await ctx.db.get(membershipId))!);
    });
    await requireMember(ctx, result.id, account._id);
    return result;
  },
});

export const invite = mutation({
  args: { token: v.string(), groupId: v.id("v0Groups"), phone: v.string(), requestId: v.string() },
  handler: async (ctx, { token, groupId, phone, requestId }) => {
    const { account } = await requireSession(ctx, token);
    await requireMember(ctx, groupId, account._id);
    const targetHash = await phoneHash(phone);
    return await once(ctx, account._id, "groups.invite", requestId, { groupId, phoneHash: targetHash }, async () => {
      await rateLimit(ctx, `groups.invite:${account._id}`, 30, 3_600_000);
      const targetPhone = await ctx.db.query("v0Phones").withIndex("by_hash", (q) => q.eq("phoneHash", targetHash)).unique();
      if (targetPhone && await isBlocked(ctx, account._id, targetPhone.accountId)) return { invited: true as const };
      const now = Date.now();
      const existing = await ctx.db.query("v0Invites").withIndex("by_phone", (q) => q.eq("phoneHash", targetHash)).collect();
      if (!existing.some((row) => row.groupId === groupId && row.inviterId === account._id && row.acceptedAt === undefined && row.revokedAt === undefined && row.expiresAt > now)) {
        await ctx.db.insert("v0Invites", { groupId, inviterId: account._id, phoneHash: targetHash, createdAt: now, expiresAt: now + 7 * 24 * 60 * 60_000 });
      }
      return { invited: true as const };
    });
  },
});

export const invitations = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { account } = await requireSession(ctx, token);
    const phones = await ctx.db.query("v0Phones").withIndex("by_account", (q) => q.eq("accountId", account._id)).collect();
    const result = [];
    for (const phone of phones) {
      const invites = await ctx.db.query("v0Invites").withIndex("by_phone", (q) => q.eq("phoneHash", phone.phoneHash)).collect();
      for (const invitation of invites) {
        if (invitation.acceptedAt !== undefined || invitation.revokedAt !== undefined || invitation.expiresAt <= Date.now()) continue;
        if (!(await activeMember(ctx, invitation.groupId, invitation.inviterId)) || await isBlocked(ctx, account._id, invitation.inviterId)) continue;
        const group = await ctx.db.get(invitation.groupId);
        if (group) result.push({ id: invitation._id, groupName: group.name, expiresAt: invitation.expiresAt });
      }
    }
    return result;
  },
});

export const accept = mutation({
  args: { token: v.string(), inviteId: v.id("v0Invites"), requestId: v.string() },
  handler: async (ctx, { token, inviteId, requestId }) => {
    const { account } = await requireSession(ctx, token);
    const result = await once(ctx, account._id, "groups.accept", requestId, { inviteId }, async () => {
      const invitation = await ctx.db.get(inviteId);
      if (!invitation || invitation.acceptedAt !== undefined || invitation.revokedAt !== undefined || invitation.expiresAt <= Date.now()) fail("NOT_AVAILABLE");
      const phones = await ctx.db.query("v0Phones").withIndex("by_account", (q) => q.eq("accountId", account._id)).collect();
      if (!phones.some((phone) => phone.phoneHash === invitation.phoneHash)) fail("NOT_AVAILABLE");
      const group = await ctx.db.get(invitation.groupId);
      const inviter = await ctx.db.get(invitation.inviterId);
      if (!group || !inviter || inviter.deletedAt !== undefined || !(await activeMember(ctx, group._id, inviter._id)) || await isBlocked(ctx, account._id, inviter._id)) fail("NOT_AVAILABLE");
      await rateLimit(ctx, `groups.accept:${account._id}`, 30, 3_600_000);
      const now = Date.now();
      await ctx.db.patch(inviteId, { acceptedAt: now });
      let member = await activeMember(ctx, group._id, account._id);
      if (!member) {
        const membershipId = await ctx.db.insert("v0Memberships", { groupId: group._id, accountId: account._id, joinedAt: now, alias: account.displayName, points: 0, streak: 0 });
        member = (await ctx.db.get(membershipId))!;
        const localDate = localDateAt(group.timezone, now);
        if (localDate && (group.lastTurnDate === undefined || group.lastTurnDate < localDate) && group.nextTurnAt > now) await ctx.db.patch(group._id, { nextTurnAt: now });
      }
      return summary(group, member);
    });
    await requireMember(ctx, result.id, account._id);
    return result;
  },
});

export const members = query({
  args: { token: v.string(), groupId: v.id("v0Groups") },
  handler: async (ctx, { token, groupId }) => {
    const { account } = await requireSession(ctx, token);
    await requireMember(ctx, groupId, account._id);
    const memberships = await ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect();
    const result = [];
    for (const member of memberships) {
      if ((await activeMember(ctx, groupId, member.accountId))?._id !== member._id || await isBlocked(ctx, account._id, member.accountId)) continue;
      const person = await ctx.db.get(member.accountId);
      if (person && person.deletedAt === undefined) result.push({ accountId: person._id, alias: member.alias, noBets: person.noBets });
    }
    return result;
  },
});

export const linkConversation = mutation({
  args: { token: v.string(), groupId: v.id("v0Groups"), conversationKey: v.string(), requestId: v.string() },
  handler: async (ctx, { token, groupId, conversationKey: key, requestId }) => {
    const { account, session } = await requireSession(ctx, token);
    await requireMember(ctx, groupId, account._id);
    conversationKey(key);
    return await once(ctx, account._id, "groups.linkConversation", requestId, { groupId, conversationKey: key, deviceId: session.deviceId }, async () => {
      await rateLimit(ctx, `groups.linkConversation:${account._id}`, 60, 60_000);
      const existing = await ctx.db.query("v0ConversationLinks").withIndex("by_key", (q) => q.eq("accountId", account._id).eq("deviceId", session.deviceId).eq("conversationKey", key)).unique();
      if (existing && existing.groupId !== groupId) fail("CONFLICT", "This conversation is already linked to another group.");
      if (!existing) await ctx.db.insert("v0ConversationLinks", { accountId: account._id, deviceId: session.deviceId, conversationKey: key, groupId, linkedAt: Date.now() });
      return { groupId };
    });
  },
});

export const resolveConversation = query({
  args: { token: v.string(), conversationKey: v.string() },
  handler: async (ctx, { token, conversationKey: key }) => {
    const { account, session } = await requireSession(ctx, token);
    conversationKey(key);
    const link = await ctx.db.query("v0ConversationLinks").withIndex("by_key", (q) => q.eq("accountId", account._id).eq("deviceId", session.deviceId).eq("conversationKey", key)).unique();
    if (!link || !(await activeMember(ctx, link.groupId, account._id)) || !(await ctx.db.get(link.groupId))) return null;
    return { groupId: link.groupId };
  },
});

export const unlinkConversation = mutation({
  args: { token: v.string(), conversationKey: v.string(), requestId: v.string() },
  handler: async (ctx, { token, conversationKey: key, requestId }) => {
    const { account, session } = await requireSession(ctx, token);
    conversationKey(key);
    return await once(ctx, account._id, "groups.unlinkConversation", requestId, { conversationKey: key, deviceId: session.deviceId }, async () => {
      await rateLimit(ctx, `groups.unlinkConversation:${account._id}`, 60, 60_000);
      const link = await ctx.db.query("v0ConversationLinks").withIndex("by_key", (q) => q.eq("accountId", account._id).eq("deviceId", session.deviceId).eq("conversationKey", key)).unique();
      if (link) await ctx.db.delete(link._id);
      return { unlinked: true as const };
    });
  },
});

function turnView(group: Doc<"v0Groups">, assigned: Doc<"v0Turns">, accountId: Id<"v0Accounts">): Turn {
  const endsAt = turnEndsAt(group, assigned);
  return { id: assigned._id, groupId: group._id, localDate: assigned.localDate, creatorId: assigned.creatorId, subjectId: assigned.subjectId, status: assigned.status, assignedAt: assigned.assignedAt, passAt: assigned.passAt, canPass: assigned.creatorId === accountId && assigned.status === "assigned" && assigned.passedFromId === undefined && endsAt !== null && Date.now() < endsAt };
}

export const turn = query({
  args: { token: v.string(), groupId: v.id("v0Groups") },
  handler: async (ctx, { token, groupId }): Promise<Turn | null> => {
    const { account } = await requireSession(ctx, token);
    const member = await requireMember(ctx, groupId, account._id);
    const group = (await ctx.db.get(groupId))!;
    const assigned = await currentTurn(ctx, group, member);
    return assigned ? turnView(group, assigned, account._id) : null;
  },
});

export const passTurn = mutation({
  args: { token: v.string(), groupId: v.id("v0Groups"), requestId: v.string() },
  handler: async (ctx, { token, groupId, requestId }): Promise<Turn | null> => {
    const { account } = await requireSession(ctx, token);
    const member = await requireMember(ctx, groupId, account._id);
    if (!requestId || requestId.length > 128) fail("INVALID_INPUT", "A request identifier is required.");
    const group = (await ctx.db.get(groupId))!;
    return await once(ctx, account._id, "groups.passTurn", requestId, { groupId }, async () => {
      const assigned = await currentTurn(ctx, group, member);
      if (!assigned) return null;
      if (!turnView(group, assigned, account._id).canPass) fail("NOT_AVAILABLE");
      await rateLimit(ctx, `groups.passTurn:${account._id}`, 30, 3_600_000);
      if (approvedPolicy.turnPassesPerDay !== 1 || !(await passTurnTo(ctx, group, assigned, Date.now()))) fail("NOT_AVAILABLE");
      const passed = (await ctx.db.get(assigned._id))!;
      return turnView(group, passed, account._id);
    });
  },
});

export const recap = query({
  args: { token: v.string(), groupId: v.id("v0Groups") },
  handler: async (ctx, { token, groupId }): Promise<Recap | null> => {
    const { account } = await requireSession(ctx, token);
    const member = await requireMember(ctx, groupId, account._id);
    const recaps = await ctx.db.query("v0Recaps").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect();
    const latest = recaps.filter((item) => Number.isFinite(item.startsAt) && Number.isFinite(item.endsAt) && item.startsAt < item.endsAt && item.endsAt > member.joinedAt && item.endsAt <= Date.now() && item.createdAt <= Date.now()).sort((a, b) => b.endsAt - a.endsAt || b.createdAt - a.createdAt)[0];
    if (!latest) return null;
    const startsAt = Math.max(latest.startsAt, member.joinedAt);
    const rows = new Map<Id<"v0Accounts">, Recap["rows"][number]>();
    for (const entry of await ctx.db.query("v0Ledger").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect()) {
      if (!entry.accountId || !entry.membershipId || entry.createdAt < startsAt || entry.createdAt >= latest.endsAt || !Number.isFinite(entry.points)) continue;
      const bet = await ctx.db.get(entry.betId);
      if (!bet || bet.groupId !== groupId || bet.state !== "finalized" || !(await canReadBet(ctx, bet, account._id)) || await isBlocked(ctx, account._id, entry.accountId)) continue;
      const person = await ctx.db.get(entry.accountId);
      const membership = await activeMember(ctx, groupId, entry.accountId);
      if (!person || person.deletedAt !== undefined || membership?._id !== entry.membershipId) continue;
      const previous = rows.get(person._id);
      rows.set(person._id, { accountId: person._id, alias: membership.alias, points: (previous?.points ?? 0) + entry.points });
    }
    return { id: latest._id, groupId, startsAt, endsAt: latest.endsAt, rows: [...rows.values()].sort((a, b) => b.points - a.points || a.alias.localeCompare(b.alias) || a.accountId.localeCompare(b.accountId)), policy: policyStatus };
  },
});

export const board = query({
  args: { token: v.string(), groupId: v.id("v0Groups") },
  handler: async (ctx, { token, groupId }) => {
    const { account } = await requireSession(ctx, token);
    await requireMember(ctx, groupId, account._id);
    const memberships = await ctx.db.query("v0Memberships").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect();
    const rows = [];
    for (const member of memberships) {
      if ((await activeMember(ctx, groupId, member.accountId))?._id !== member._id || await isBlocked(ctx, account._id, member.accountId)) continue;
      const person = await ctx.db.get(member.accountId);
      if (person && person.deletedAt === undefined) rows.push({ accountId: person._id, alias: member.alias, points: member.points, streak: member.streak });
    }
    rows.sort((a, b) => b.points - a.points || a.alias.localeCompare(b.alias) || a.accountId.localeCompare(b.accountId));
    return { groupId, rows, goal: await boardGoal(ctx, groupId, account._id), policy: policyStatus };
  },
});

export const proposeGoal = mutation({
  args: { token: v.string(), groupId: v.id("v0Groups"), label: v.string(), targetPoints: v.number(), requestId: v.string() },
  handler: async (ctx, { token, groupId, label, targetPoints, requestId }): Promise<Goal> => {
    const { account } = await requireSession(ctx, token);
    await requireMember(ctx, groupId, account._id);
    if (label.length > 160 || !Number.isInteger(targetPoints) || targetPoints < approvedPolicy.goalTargetMinPoints || targetPoints > approvedPolicy.goalTargetMaxPoints) fail("INVALID_INPUT", "Enter a goal name and a whole number of points.");
    const cleanLabel = validateCandidate({ question: label, format: "yes_no", options: ["Yes", "No"] }, { blockedTopics: account.blockedTopics }).question;
    if (cleanLabel.length > 80) fail("INVALID_INPUT", "Enter a shorter goal name.");
    return await once(ctx, account._id, "groups.proposeGoal", requestId, { groupId, label, targetPoints }, async () => {
      const goals = await groupGoals(ctx, groupId);
      if (goals.pending || (goals.active && goals.activeProgress < goals.active.targetPoints)) fail("CONFLICT", "This group already has a shared goal.");
      await rateLimit(ctx, `groups.proposeGoal:${account._id}`, 10, 3_600_000);
      const goalId = await ctx.db.insert("v0Goals", { groupId, proposerId: account._id, label: cleanLabel, targetPoints, confirmedBy: [account._id], state: "proposed", createdAt: Date.now() });
      return await settleGoal(ctx, (await ctx.db.get(goalId))!, account._id);
    });
  },
});

export const confirmGoal = mutation({
  args: { token: v.string(), groupId: v.id("v0Groups"), requestId: v.string() },
  handler: async (ctx, { token, groupId, requestId }): Promise<Goal> => {
    const { account } = await requireSession(ctx, token);
    await requireMember(ctx, groupId, account._id);
    return await once(ctx, account._id, "groups.confirmGoal", requestId, { groupId }, async () => {
      const { pending } = await groupGoals(ctx, groupId);
      if (!pending || await isBlocked(ctx, account._id, pending.proposerId)) fail("NOT_AVAILABLE");
      await rateLimit(ctx, `groups.confirmGoal:${account._id}`, 30, 3_600_000);
      if (!pending.confirmedBy.includes(account._id)) await ctx.db.patch(pending._id, { confirmedBy: [...pending.confirmedBy, account._id] });
      return await settleGoal(ctx, (await ctx.db.get(pending._id))!, account._id);
    });
  },
});

async function groupGoals(ctx: QueryCtx, groupId: Id<"v0Groups">) {
  const now = Date.now();
  const rows = (await ctx.db.query("v0Goals").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect()).filter((goal) => Number.isFinite(goal.createdAt) && goal.createdAt <= now);
  const confirmed = rows.filter((goal) => goal.state === "confirmed" && goal.confirmedAt !== undefined && Number.isFinite(goal.confirmedAt) && goal.confirmedAt <= now).sort((a, b) => b.confirmedAt! - a.confirmedAt! || b._creationTime - a._creationTime);
  const active = confirmed[0] ?? null;
  const pending = rows.filter((goal) => goal.state === "proposed" && now < goal.createdAt + approvedPolicy.goalProposalDurationMs && (!active || goal.createdAt >= active.confirmedAt!)).sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime)[0] ?? null;
  let activeProgress = 0;
  if (active) {
    for (const entry of await ctx.db.query("v0Ledger").withIndex("by_group", (q) => q.eq("groupId", groupId)).collect()) {
      if (Number.isFinite(entry.points) && entry.points > 0 && entry.createdAt >= active.confirmedAt! && entry.createdAt <= now) activeProgress += entry.points;
    }
  }
  return { active, activeProgress, pending };
}

async function goalView(ctx: QueryCtx, goal: Doc<"v0Goals">, progressPoints: number, viewerId: Id<"v0Accounts">): Promise<Goal> {
  const confirmedBy: Id<"v0Accounts">[] = [];
  for (const accountId of goal.confirmedBy) {
    if (await activeMember(ctx, goal.groupId, accountId) && !(await isBlocked(ctx, viewerId, accountId))) confirmedBy.push(accountId);
  }
  return { id: goal._id, label: goal.label, targetPoints: goal.targetPoints, confirmedBy, state: goal.state, progressPoints };
}

async function settleGoal(ctx: MutationCtx, goal: Doc<"v0Goals">, viewerId: Id<"v0Accounts">): Promise<Goal> {
  const members = await activeMembers(ctx, goal.groupId);
  const confirmers = members.filter((entry) => goal.confirmedBy.includes(entry.account._id)).length;
  if (goal.state === "proposed" && confirmers * 2 > members.length) {
    await ctx.db.patch(goal._id, { state: "confirmed", confirmedAt: Date.now() });
    goal = (await ctx.db.get(goal._id))!;
  }
  return await goalView(ctx, goal, 0, viewerId);
}

async function boardGoal(ctx: QueryCtx, groupId: Id<"v0Groups">, viewerId: Id<"v0Accounts">): Promise<Goal | null> {
  const { active, activeProgress, pending } = await groupGoals(ctx, groupId);
  if (active && activeProgress < active.targetPoints) return await goalView(ctx, active, activeProgress, viewerId);
  if (pending && !(await isBlocked(ctx, viewerId, pending.proposerId))) return await goalView(ctx, pending, 0, viewerId);
  return active ? await goalView(ctx, active, activeProgress, viewerId) : null;
}
