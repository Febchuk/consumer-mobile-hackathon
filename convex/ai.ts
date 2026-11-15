"use node";
import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";

type Draft = { question: string; kind: "yesno" | "overunder"; line?: number };

const SYSTEM = `You write bets for "Called It", a social prediction market played live by a room of friends (today: a YC consumer mobile hackathon in San Francisco).
From the notes or transcript you are given, draft exactly 6 bets that:
- resolve by ~8 PM tonight from something everyone in the room can observe,
- are fun, specific, and never embarrassing, mean, or about sensitive topics,
- use only two formats: "yesno" (a yes/no question) or "overunder" (a numeric question with a line ending in .5, e.g. 3.5),
- are short (under 90 characters) and phrased as a question.
Reply with JSON only: {"bets":[{"question":"...","kind":"yesno"},{"question":"...","kind":"overunder","line":4.5}]}`;

function clean(raw: unknown): Draft[] {
  const list = (raw as { bets?: unknown[] })?.bets ?? [];
  return list
    .map((b) => b as { question?: unknown; kind?: unknown; line?: unknown })
    .filter((b) => typeof b.question === "string" && (b.kind === "yesno" || b.kind === "overunder"))
    .map((b) => {
      if (b.kind === "overunder") {
        const n = Number(b.line);
        const line = Number.isFinite(n) ? Math.floor(n) + 0.5 : 2.5;
        return { question: String(b.question).slice(0, 140), kind: "overunder" as const, line };
      }
      return { question: String(b.question).slice(0, 140), kind: "yesno" as const };
    })
    .slice(0, 6);
}

function parseJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(text.slice(start, end + 1));
}

export const draftBets = action({
  args: { passcode: v.string(), text: v.string() },
  handler: async (_ctx, { passcode, text }): Promise<Draft[]> => {
    if (!process.env.ADMIN_PASSCODE || passcode !== process.env.ADMIN_PASSCODE) throw new ConvexError("Wrong passcode");
    const notes = text.trim().slice(0, 20000);
    if (notes.length < 10) throw new ConvexError("Paste some notes or a transcript first");
    const anthropic = process.env.ANTHROPIC_API_KEY;
    const openai = process.env.OPENAI_API_KEY;
    if (anthropic) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anthropic, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: process.env.AI_MODEL ?? "claude-sonnet-4-5",
          max_tokens: 1200,
          system: SYSTEM,
          messages: [{ role: "user", content: notes }],
        }),
      });
      if (!res.ok) throw new ConvexError("AI request failed (" + res.status + "): " + (await res.text()).slice(0, 200));
      const body = (await res.json()) as { content: { type: string; text?: string }[] };
      return clean(parseJson(body.content.map((c) => c.text ?? "").join("")));
    }
    if (openai) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer " + openai, "content-type": "application/json" },
        body: JSON.stringify({
          model: process.env.AI_MODEL ?? "gpt-4.1-mini",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: notes },
          ],
        }),
      });
      if (!res.ok) throw new ConvexError("AI request failed (" + res.status + "): " + (await res.text()).slice(0, 200));
      const body = (await res.json()) as { choices: { message: { content: string } }[] };
      return clean(parseJson(body.choices[0].message.content));
    }
    throw new ConvexError("No AI key set. Add ANTHROPIC_API_KEY or OPENAI_API_KEY in Convex env vars.");
  },
});
