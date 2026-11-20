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

const inventory = JSON.parse(readFileSync("tests/coverage/inventory.json", "utf8")).cases.flatMap((entry) => entry.assertions).filter((assertion) => assertion.layer === "U").map((assertion) => assertion.id);
const nativeBindings = JSON.parse(readFileSync("tests/coverage/native-bindings.json", "utf8"));
const nativeStatus = JSON.parse(readFileSync("tests/coverage/native-status.json", "utf8"));
for (const id of [...Object.keys(nativeBindings), ...Object.keys(nativeStatus.notes), ...Object.keys(nativeStatus.blocked)]) {
  if (!inventory.includes(id)) failures.push(`native coverage names ${id}, which is not a native assertion in tests/coverage/inventory.json`);
}
for (const id of Object.keys(nativeStatus.blocked)) if (nativeBindings[id]) failures.push(`${id} is both bound and blocked in the native coverage files`);
for (const id of Object.keys(nativeStatus.notes)) if (!nativeBindings[id]) failures.push(`${id} has a native binding note and no binding`);
for (const [id, tests] of Object.entries(nativeBindings)) {
  for (const name of tests) {
    const [, className, test] = name.match(/^NATIVE-UI\.([A-Za-z0-9]+)\.(test[A-Za-z0-9]+)$/) ?? [];
    let source = "";
    try { source = readFileSync(`native-imessage/UITests/${className}.swift`, "utf8"); } catch { /* reported below */ }
    if (!source.includes(`func ${test}()`)) failures.push(`${id} is bound to ${name}, which is not a test in native-imessage/UITests`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("static page, deployment-address and native coverage checks passed");
