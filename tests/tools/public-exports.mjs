import ts from "typescript";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";

export function publicExports(root) {
  const exports = [];
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.name === "_generated") continue;
      const path = resolve(dir, item.name);
      if (item.isDirectory()) { walk(path); continue; }
      if (!item.name.endsWith(".ts") || item.name.endsWith(".d.ts")) continue;
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
          const kind = declaration.initializer.expression.getText(source);
          if (["query", "mutation", "action", "httpAction"].includes(kind)) exports.push({ path: `${relative(resolve(root, "convex"), path).replace(/\.ts$/, "").replaceAll("\\", "/")}:${declaration.name.text}`, kind });
        }
      }
    }
  };
  walk(resolve(root, "convex"));
  return exports.sort((a, b) => a.path.localeCompare(b.path));
}

if (process.argv.includes("--write")) {
  const inventory = publicExports(process.cwd()).map((entry) => ({ ...entry, requiredPolicy: entry.kind === "httpAction" ? "public-static-only-no-private-reads" : entry.path.startsWith("v0Runtime:") ? "anonymous-neutral-attestation" : entry.path.startsWith("v0Auth:requestCode") || entry.path.startsWith("v0Auth:verifyCode") || entry.path.startsWith("v0Auth:redeemPair") ? "bounded-anonymous-auth" : entry.path.startsWith("v0") ? "verified-session-active-membership-subject-time-state" : "legacy-disable-or-apply-full-v0-policy", verification: "blocked-runtime-policy-matrix" }));
  writeFileSync(new URL("../coverage/public-exports.json", import.meta.url), JSON.stringify(inventory, null, 2) + "\n");
  console.log(JSON.stringify({ publicExports: inventory.length, runtimeVerification: "blocked" }));
}
