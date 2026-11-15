import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    emoji: v.string(),
    token: v.string(),
    points: v.number(),
    streak: v.number(),
    lastRoundNumber: v.optional(v.number()),
    lastRoundId: v.optional(v.id("rounds")),
    lastSeen: v.number(),
    username: v.optional(v.string()),
  })
    .index("by_token", ["token"])
    .index("by_points", ["points"])
    .index("by_username", ["username"]),
  groups: defineTable({
    name: v.string(),
    createdBy: v.optional(v.id("users")),
    isDefault: v.optional(v.boolean()),
  }).index("by_default", ["isDefault"]),
  members: defineTable({
    groupId: v.id("groups"),
    userId: v.id("users"),
  })
    .index("by_group", ["groupId"])
    .index("by_user", ["userId"])
    .index("by_group_user", ["groupId", "userId"]),
  rounds: defineTable({
    number: v.number(),
    title: v.string(),
    opensAt: v.number(),
    locksAt: v.number(),
    revealAt: v.optional(v.number()),
    groupId: v.optional(v.id("groups")),
  })
    .index("by_number", ["number"])
    .index("by_opensAt", ["opensAt"])
    .index("by_group_opensAt", ["groupId", "opensAt"]),
  bets: defineTable({
    roundId: v.id("rounds"),
    question: v.string(),
    kind: v.union(v.literal("yesno"), v.literal("overunder"), v.literal("multi")),
    options: v.array(v.string()),
    line: v.optional(v.number()),
    pools: v.array(v.number()),
    status: v.union(v.literal("open"), v.literal("locked"), v.literal("settled"), v.literal("refunded")),
    winningOption: v.optional(v.number()),
    subjectUserId: v.optional(v.id("users")),
    hidden: v.optional(v.boolean()),
    order: v.number(),
  }).index("by_round", ["roundId"]),
  stakes: defineTable({
    betId: v.id("bets"),
    roundId: v.id("rounds"),
    userId: v.id("users"),
    option: v.number(),
    amount: v.number(),
    late: v.boolean(),
    streakAtBet: v.number(),
    payout: v.optional(v.number()),
  })
    .index("by_bet", ["betId"])
    .index("by_user", ["userId"])
    .index("by_round_user", ["roundId", "userId"]),
  ticks: defineTable({
    betId: v.id("bets"),
    t: v.number(),
    pct: v.array(v.number()),
  }).index("by_bet", ["betId"]),
  assets: defineTable({
    path: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    deployId: v.string(),
  }).index("by_path", ["path"]),
});
