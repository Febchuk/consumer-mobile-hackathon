import type { Doc } from "./_generated/dataModel";
import type { BetState } from "./v0Contract";

const wrongPickPenaltyFraction: number = 0;

export const approvedPolicy = {
  version: "v0-policy.3",
  approvedOn: "2026-11-17",
  economics: wrongPickPenaltyFraction === 0 ? "reward_only" : "confidence_penalty",
  confidenceMin: 0.01,
  confidenceMax: 1,
  confidencePointScale: 100,
  wrongPickPenaltyFraction,
  streakBonusPerCorrectPick: 0.1,
  streakMultiplierCap: 2,
  pickLock: "final_confirmation",
  pickAdmissionEnd: "reveal",
  defaultRevealHour: 20,
  customRevealMinLeadMs: 10 * 60_000,
  customRevealMaxLeadMs: 7 * 24 * 60 * 60_000,
  challengeDurationMs: 60 * 60_000,
  unansweredDurationMs: 24 * 60 * 60_000,
  turnStartHour: 8,
  turnPassHour: 12,
  turnEndHour: 20,
  turnPassesPerDay: 1,
  minActiveMembers: 3,
  betsPerGroupPerDay: 1,
  goalTargetMinPoints: 100,
  goalTargetMaxPoints: 1_000_000,
  goalProposalDurationMs: 7 * 24 * 60 * 60_000,
  recapWeekday: 0,
  recapHour: 18,
  recapWindowDays: 7,
};

export const recapLateLimitMs = 24 * 60 * 60_000;

export type ScoringPolicy = Pick<typeof approvedPolicy, "confidencePointScale" | "wrongPickPenaltyFraction" | "streakBonusPerCorrectPick" | "streakMultiplierCap">;

function roundHalfUp(value: number) {
  return Math.floor(value + 0.5 + 1e-9);
}

export function scorePick(input: { confidence: number; correct: boolean; streak: number; balance: number }, policy: ScoringPolicy = approvedPolicy) {
  if (!input.correct) {
    const loss = Math.min(Math.max(0, input.balance), roundHalfUp(policy.confidencePointScale * input.confidence * policy.wrongPickPenaltyFraction));
    return { points: loss > 0 ? -loss : 0, streak: 0 };
  }
  const streak = input.streak + 1;
  const multiplier = Math.min(policy.streakMultiplierCap, 1 + policy.streakBonusPerCorrectPick * (streak - 1));
  return { points: roundHalfUp(policy.confidencePointScale * input.confidence * multiplier), streak };
}

export function answerDeadlineFor(bet: Doc<"v0Bets">) {
  return bet.revealAt + approvedPolicy.unansweredDurationMs;
}

export function challengeDeadlineFor(bet: Doc<"v0Bets">) {
  if (bet.answeredAt === undefined || !Number.isFinite(bet.answeredAt) || bet.answeredAt > Date.now() || bet.answeredAt < bet.revealAt || bet.answeredAt >= answerDeadlineFor(bet) || ![0, 1].includes(bet.provisionalOutcome ?? -1)) return undefined;
  return bet.answeredAt + approvedPolicy.challengeDurationMs;
}

export function stateAt(bet: Doc<"v0Bets">, now: number): BetState {
  if (bet.state === "voided" || bet.state === "finalized" || bet.state === "provisional") return bet.state;
  if (now >= answerDeadlineFor(bet)) return "voided";
  if (now < bet.revealAt) return "open";
  return "revealed";
}

export function nextDefaultRevealAt(timezone: string, now: number): number | null {
  if (!Number.isFinite(now)) return null;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const localAsUtc = (time: number) => {
    const parts = formatter.formatToParts(time);
    const part = (name: string) => Number(parts.find((entry) => entry.type === name)?.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  };
  const local = new Date(localAsUtc(now));
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), approvedPolicy.defaultRevealHour);
  for (let day = 0; day < 3; day++) {
    const target = today + day * 24 * 60 * 60_000;
    let candidate = target;
    for (let attempt = 0; attempt < 4; attempt++) {
      const observed = localAsUtc(candidate);
      if (observed === target && candidate > now) return candidate;
      candidate += target - observed;
    }
  }
  return null;
}

function zoneClock(timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  return (time: number) => {
    const parts = formatter.formatToParts(time);
    const part = (name: string) => Number(parts.find((entry) => entry.type === name)?.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  };
}

export function localDateAt(timezone: string, now: number): string | null {
  if (!Number.isFinite(now)) return null;
  try {
    return new Date(zoneClock(timezone)(now)).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export function localInstant(timezone: string, localDate: string, hour: number, dayOffset = 0): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + dayOffset, hour);
  if (!Number.isFinite(target)) return null;
  try {
    const clock = zoneClock(timezone);
    let candidate = target;
    for (let attempt = 0; attempt < 4; attempt++) {
      const observed = clock(candidate);
      if (observed === target) return candidate;
      candidate += target - observed;
    }
  } catch {
    return null;
  }
  return null;
}

export function recapWeek(timezone: string, now: number): { localDate: string; startsAt: number; endsAt: number; nextAt: number } | null {
  const today = localDateAt(timezone, now);
  if (!today) return null;
  const midnight = Date.parse(`${today}T00:00:00Z`);
  let back = (new Date(midnight).getUTCDay() - approvedPolicy.recapWeekday + 7) % 7;
  const at = (dayOffset: number) => localInstant(timezone, today, approvedPolicy.recapHour, dayOffset);
  const sameWeek = at(-back);
  if (sameWeek === null) return null;
  if (sameWeek > now) back += 7;
  const [startsAt, endsAt, nextAt] = [at(-back - approvedPolicy.recapWindowDays), at(-back), at(7 - back)];
  if (startsAt === null || endsAt === null || nextAt === null || !(startsAt < endsAt && endsAt <= now && now < nextAt)) return null;
  return { localDate: new Date(midnight - back * 24 * 60 * 60_000).toISOString().slice(0, 10), startsAt, endsAt, nextAt };
}
