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
const policyAddenda = [];
if (args.includes("--decision-addendum")) {
  const path = resolve(option("--decision-addendum"));
  if (path === process.cwd() || path.startsWith(`${process.cwd()}/`)) throw new Error("Product decision text must remain outside the repository");
  const raw = readFileSync(path, "utf8");
  const policy = JSON.parse(raw);
  const preserved = policy.baselinePreserved;
  if (policy.schemaVersion !== 1 || typeof policy.version !== "string" || !policy.version || !Array.isArray(policy.decisions) || !Array.isArray(policy.plannedAssertions) ||
      preserved?.requirementCount !== requirements.length || preserved.acceptanceCheckboxCount !== actualAcceptanceLines.length ||
      requirements.find((item) => item.id === preserved.editablePickRequirement)?.sha256 !== preserved.editablePickSha256) throw new Error("Decision addendum must preserve the pinned original acceptance inventory");
  for (const assertion of policy.plannedAssertions) {
    if (!assertion.id || !assertion.status || !Array.isArray(assertion.caseIds) || assertion.caseIds.some((id) => !inventory.cases.some((item) => item.id === id))) throw new Error("Decision assertion must map to existing acceptance cases");
  }
  policyAddenda.push({ version: policy.version, decisionDate: policy.decisionDate, sourcePath: path, sha256: hash(raw), baselinePreserved: true, assertions: policy.plannedAssertions.map(({ id, status, caseIds }) => ({ id, status, caseIds })), executionCredit: "none; decision metadata is not execution evidence" });
}
const document = { schemaVersion: 1, sourceDigests: Object.fromEntries(Object.entries(sources).map(([name, text]) => [name, hash(text)])), acceptanceCheckboxCount: actualAcceptanceLines.length, requirements, ...(policyAddenda.length ? { policyAddenda } : {}) };
writeFileSync(output, JSON.stringify(document, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ requirements: requirements.length, acceptanceCheckboxes: actualAcceptanceLines.length, assertionReferences: requirements.reduce((n, r) => n + r.assertions.length, 0) }));
