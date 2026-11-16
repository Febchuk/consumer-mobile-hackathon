# V0 acceptance and regression tests

This is an assertion-based test component, not a release certificate. It changes no product handlers or production data. `coverage/inventory.json` lists all J1–J9, SEC1–SEC5, N1–N3 and R1–R5 cases with assertion IDs, required layers and explicit blockers. `requirement-map.json` maps 22 V0 acceptance checkboxes, journey steps/controls/edge cases and system requirements to those assertions. Original specification text stays outside this repository.

## Safe backend run

Use Node 24.22.3 and the root-owned pinned dependencies. On an isolated Linux runner:

```sh
env -i PATH="$PATH" HOME="$HOME" node tests/run-isolated.mjs --output "$HOME/.capy/work/v0-run-unique"
env -i PATH="$PATH" HOME="$HOME" unshare --user --map-root-user --net node --test tests/tools/evidence.test.mjs
env -i PATH="$PATH" HOME="$HOME" npm run typecheck
env -i PATH="$PATH" HOME="$HOME" npm run lint
```

The first command constructs an environment allowlist, creates a fresh HOME, enters a new user/network namespace, checks that no external route exists, and denies fetch unless a case explicitly installs a synthetic adapter. There is no network-enabled fallback. It rejects an existing report directory, direct Vitest execution, deployment/provider credentials and ambiguous target configuration. Each case uses schema-validated `convex-test`, real exported handlers, a fresh database and unique synthetic namespace. It never runs Convex deployment/codegen or a live HTTP client. Linux user namespaces are required; permission failure is blocked infrastructure, not a skipped pass.

`tests/baseline` preserves the original positive-behavior/privacy/ledger assertions. They produced 63 failures and 79 passes (including isolation tests) at test commit `8d11da4`, whose product source is PR3 `d23f9e7`. To reproduce that historical baseline, use a separate checkout at `8d11da4`, the pinned tooling listed in its run manifest, and that commit’s `tests/run-isolated.mjs`. Do not run those active-legacy expectations as though retired APIs are the new V0 implementation. They are intentionally separate from the current backend lane; no assertion was weakened, and none of their missing canonical replacement assertions is counted as passing.

The current backend lane separately asserts every retired public query/mutation/action fails closed for every fixture role, and the public static HTTP handler serves only registered neutral fixture assets. `v0-fixture.ts` seeds the actual additive V0 schema, hashed sessions and membership intervals, but this is fixture validation, not proof that new business handlers exist. Fake OTP/APNs/LLM/storage adapters are test utilities, not proof those providers are integrated. Do not invent handler paths, numeric confidence scoring, challenge windows or timeout rules. Concurrency against the mock does not prove real Convex transaction conflicts; an isolated local real-backend lane remains required.

`tests/tsconfig.json` permits a focused harness typecheck without Expo globals. Root typecheck/lint remain required. The source-export inventory is an AST drift guard, not authorization proof: every listed public function still needs runtime policy assertions. Regenerate it only after reviewing the changed export contract:

```sh
node tests/tools/public-exports.mjs --write
```

## Evidence and coverage

Every backend run writes `run.json`, `fixtures.jsonl`, `vitest.json` and `evidence.json` outside the checkout. Metadata pins candidate SHA, backend source digest, test source digest, exact dependency versions, OS/Node, run namespace, per-case assertion IDs and errors. Backend deployment, native build, operator proof and provider run IDs remain null/empty unless independently obtained. `bindings.json` explicitly maps execution IDs to acceptance assertions; missing/native/physical assertions stay blocked even when backend tests pass. A failing assertion remains failing, and no skipped/loader-failed suite becomes green.

The private source extraction command verifies the pinned source digests, rejects unmapped V0 acceptance checkboxes and writes the original criterion text only outside the repository:

```sh
node tests/tools/extract-acceptance.mjs \
  --spec-root "$PRIVATE_SPEC_DIRECTORY" \
  --output "$HOME/.capy/work/v0-acceptance-private.json"
```

Keep baseline red evidence when integrating a fix. Inspect failures against the contract before calling them product defects: the first retirement run’s nine errors were the harness treating an HTTP action as a query; they were not nine product failures. The HTTP handler now has a real router/response assertion instead. Disabling a legacy endpoint safely may satisfy its retirement assertion, but never substitutes for testing its canonical V0 replacement. Full V0 readiness requires every uncut layer on the integrated candidate, not a count of test filenames or screenshots.

## Native and physical lanes

Native assertion sources and runtime/target requests live under `native-imessage/Tests`, `UITests` and `TestSupport`. They require a dedicated clean simulator and real shared implementation; no personal Messages launch, contact search, pairing or sends are automated. Swift/Xcode execution is blocked on this Linux machine. Native target wiring belongs to the native owner. `PHYSICAL-QA.md` is the operator checklist for the separately authorized three-phone and distributed-install gate, including limited Revyl capability preflight.
