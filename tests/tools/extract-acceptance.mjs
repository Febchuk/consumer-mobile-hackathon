import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const option = (key) => args[args.indexOf(key) + 1];
if (!args.includes("--spec-root") || !args.includes("--output")) throw new Error("Require --spec-root and --output (private, outside repository)");
const output = resolve(option("--output"));
if (output.startsWith(`${process.cwd()}/`)) throw new Error("Do not put user specification text in the repository");
const mapping = JSON.parse(readFileSync(new URL("../coverage/requirement-map.json", import.meta.url), "utf8"));
const inventory = JSON.parse(readFileSync(new URL("../coverage/inventory.json", import.meta.url), "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sources = Object.fromEntries(mapping.sources.map((name) => [name, readFileSync(resolve(option("--spec-root"), name), "utf8")]));
for (const [name, text] of Object.entries(sources)) {
  if (hash(text) !== mapping.sourceDigests[name]) throw new Error(`Source ${name} changed; review and remap it before extracting`);
}
const actualAcceptanceLines = sources["key-user-journeys.md"].split("\n").flatMap((line, i) => i < 213 && line.startsWith("- [ ]") && !line.includes("V1:") ? [i + 1] : []);
if (actualAcceptanceLines.length === 0) throw new Error("No acceptance criteria extracted");
for (const line of actualAcceptanceLines) {
  if (!mapping.requirements.some((r) => r.source === "key-user-journeys.md" && r.lines[0] === line)) throw new Error(`Unmapped acceptance criterion at line ${line}`);
}
const requirements = mapping.requirements.map((r) => {
  const text = sources[r.source].split("\n").slice(r.lines[0] - 1, r.lines[1]).join("\n");
  if (!text.trim()) throw new Error(`Missing source text for ${r.id}`);
  const cases = r.caseIds.map((id) => {
    const item = inventory.cases.find((c) => c.id === id);
    if (!item) throw new Error(`Unknown case ${id}`);
    return item;
  });
  return { ...r, sha256: hash(text), text, assertions: cases.flatMap((c) => c.assertions) };
});
const document = { schemaVersion: 1, sourceDigests: Object.fromEntries(Object.entries(sources).map(([name, text]) => [name, hash(text)])), acceptanceCheckboxCount: actualAcceptanceLines.length, requirements };
writeFileSync(output, JSON.stringify(document, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ requirements: requirements.length, acceptanceCheckboxes: actualAcceptanceLines.length, assertionReferences: requirements.reduce((n, r) => n + r.assertions.length, 0) }));
