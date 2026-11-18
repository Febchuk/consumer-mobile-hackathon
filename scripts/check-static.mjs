import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const failures = [];

const page = readFileSync("web/index.html", "utf8");
for (const [pattern, why] of [
  [/<script|\son[a-z]+=|javascript:/i, "runs a script"],
  [/https?:|\ssrc=|\shref=|<form|<input|url\(/i, "links to or loads something"],
  [/on-device|chats? you shared|what you shared|reading your/i, "claims to read shared material"],
]) if (pattern.test(page)) failures.push(`web/index.html ${why}: ${pattern}`);
for (const required of ["iPhone", "iMessage", "does not read your chats, photos or contacts", "no web version"]) {
  if (!page.includes(required)) failures.push(`web/index.html no longer says "${required}"`);
}

const deployment = /reliable-kookabura|[a-z0-9-]+\.convex\.(cloud|site)/i;
const allowed = (file) => file.startsWith("tests/") || file === "release/test_candidate.py" || file === "scripts/check-static.mjs";
for (const file of execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)) {
  if (allowed(file) || /\.(png|jpg|svg|ico)$/.test(file)) continue;
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  const match = text.match(deployment);
  if (match) failures.push(`${file} names a Convex deployment (${match[0]}); read it from the environment and fail when it is unset`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("static page and deployment-address checks passed");
