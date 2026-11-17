import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { requireOtpProvider } from "./v0AuthProvider";

export type CleanupOutcome = "removed" | "retry" | "rejected";
export type CleanupTransport = (request: { url: string; authorization: string; body: string }) => Promise<{ status: number; body: string }>;
type ProviderConfiguration = { accountSid: string; authToken: string; serviceSid: string };
type CleanupLease = { id: Id<"v0ProviderCleanup">; attempt: number; references: string[] };

export const maxCleanupAttempts = 5;
export const referencesPerAttempt = 8;
const batchSize = 5;
const claimRef = makeFunctionReference<"mutation", Record<string, never>, CleanupLease[]>("v0ProviderCleanup:claim");
const recordRef = makeFunctionReference<"mutation", { id: Id<"v0ProviderCleanup">; attempt: number; removed: string[]; refused: string[]; interrupted: boolean }, null>("v0ProviderCleanup:record");
export const runProviderCleanup = makeFunctionReference<"action", Record<string, never>, { claimed: number }>("v0ProviderCleanup:run");

export function cleanupRetryDelayMs(attempt: number) {
  return 5 * 60_000 * 4 ** (attempt - 1);
}

function configuration(): ProviderConfiguration | null {
  try {
    return requireOtpProvider();
  } catch {
    return null;
  }
}

export function providerCleanupConfigured() {
  return configuration() !== null;
}

const httpTransport: CleanupTransport = async ({ url, authorization, body }) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.text() };
};

export async function removeVerification(config: ProviderConfiguration, reference: string, transport: CleanupTransport = httpTransport): Promise<CleanupOutcome> {
  if (!/^VE[0-9a-fA-F]{32}$/.test(reference)) return "rejected";
  let reply: { status: number; body: string };
  try {
    reply = await transport({
      url: `https://verify.twilio.com/v2/Services/${config.serviceSid}/Verifications/${reference}`,
      authorization: `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`,
      body: new URLSearchParams({ Status: "canceled" }).toString(),
    });
  } catch {
    return "retry";
  }
  if (reply.status === 404) return "removed";
  if (reply.status === 200) {
    try {
      const data = JSON.parse(reply.body) as { sid?: unknown; status?: unknown } | null;
      return data?.sid === reference && data.status === "canceled" ? "removed" : "retry";
    } catch {
      return "retry";
    }
  }
  if ([401, 403, 408, 429].includes(reply.status) || reply.status >= 500) return "retry";
  return "rejected";
}

export const claim = internalMutation({
  args: {},
  handler: async (ctx): Promise<CleanupLease[]> => {
    const now = Date.now();
    const rows = await ctx.db.query("v0ProviderCleanup").withIndex("by_state_available", (q) => q.eq("state", "pending").lte("availableAt", now)).take(batchSize);
    const leases: CleanupLease[] = [];
    for (const row of rows) {
      if (!row.references.length) {
        await ctx.db.patch(row._id, { state: "complete" });
        continue;
      }
      if (row.attempts >= maxCleanupAttempts) {
        await ctx.db.patch(row._id, { state: "manual_required" });
        continue;
      }
      const attempt = row.attempts + 1;
      await ctx.db.patch(row._id, { attempts: attempt, availableAt: now + cleanupRetryDelayMs(attempt) });
      leases.push({ id: row._id, attempt, references: row.references.slice(0, referencesPerAttempt) });
    }
    return leases;
  },
});

export const record = internalMutation({
  args: { id: v.id("v0ProviderCleanup"), attempt: v.number(), removed: v.array(v.string()), refused: v.array(v.string()), interrupted: v.boolean() },
  handler: async (ctx, { id, attempt, removed, refused, interrupted }) => {
    const row = await ctx.db.get(id);
    if (!row || row.state !== "pending" || row.attempts !== attempt) return null;
    const remaining = row.references.filter((reference) => !removed.includes(reference));
    const kept = remaining.filter((reference) => refused.includes(reference));
    const references = [...remaining.filter((reference) => !refused.includes(reference)), ...kept];
    if (!references.length) await ctx.db.patch(id, { references, state: "complete" });
    else if (kept.length === references.length) await ctx.db.patch(id, { references, state: "manual_required" });
    else if (removed.length && !interrupted) await ctx.db.patch(id, { references, attempts: attempt - 1, availableAt: Date.now() });
    else await ctx.db.patch(id, { references, state: attempt >= maxCleanupAttempts ? "manual_required" : "pending" });
    return null;
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ claimed: number }> => {
    const config = configuration();
    if (!config) return { claimed: 0 };
    const leases = await ctx.runMutation(claimRef, {});
    for (const lease of leases) {
      const removed: string[] = [];
      const refused: string[] = [];
      let interrupted = false;
      for (const reference of lease.references) {
        const outcome = await removeVerification(config, reference);
        if (outcome === "removed") removed.push(reference);
        else if (outcome === "rejected") refused.push(reference);
        else {
          interrupted = true;
          break;
        }
      }
      await ctx.runMutation(recordRef, { id: lease.id, attempt: lease.attempt, removed, refused, interrupted });
    }
    return { claimed: leases.length };
  },
});
