# Isolated official backend binding

This test-only harness runs the official Convex OSS backend with the repository's actual registered V0 handlers. Phone auth keeps its fixed HTTPS Twilio URL and its real retry, verification, replay and session policies. A local CONNECT/TLS transport supplies synthetic provider responses; it does not replace those handlers. Nothing here authorizes a production deployment or provides native UI, physical-device, real-provider or full-V0 readiness evidence.

## Pins and prerequisites

`binary-pins.json` pins the official release URL, upstream commit, archive digest and extracted executable digest separately for Linux x64 and Darwin arm64. The Darwin archive digest matched the official GitHub release API and downloaded bytes; the extracted executable was hashed on Linux, not executed on macOS. Do not pass an archive digest as `expectedBinarySHA256`, and do not use the Linux executable hash on a Mac.

Download the Darwin arm64 asset before applying egress denial, without using deployment credentials:

```sh
mkdir -p "$HOME/.capy/work"
TOOLCHAIN="$(mktemp -d "$HOME/.capy/work/qt-XXXXXX")"
curl --disable --fail --location --proto '=https' --tlsv1.2 \
  'https://github.com/convex/convex-backend/releases/download/precompiled-2026-10-22-1447815/convex-local-backend-aarch64-apple-darwin.zip' \
  --output "$TOOLCHAIN/backend.zip"
printf '9caa539df14dff09317c1f1c22714ed77640e2e4a18ef630bc368fe8c6bb65df  %s\n' "$TOOLCHAIN/backend.zip" | shasum -a 256 --check
unzip -p "$TOOLCHAIN/backend.zip" convex-local-backend > "$TOOLCHAIN/convex-local-backend"
printf 'a19fa79daa71902491ac2fef6af7fb8e6137f68fa0600f24ec86915a1c6c3614  %s\n' "$TOOLCHAIN/convex-local-backend" | shasum -a 256 --check
chmod 700 "$TOOLCHAIN/convex-local-backend"
```

Stop if either digest differs. Extraction is not runtime verification. macOS still needs a real backend startup, actual HTTPS trust-path verification, an erased simulator and verified PF isolation before native credit is possible.

Use installed repository dependencies, Node 24, OpenSSL 3, and a writable short canonical scratch parent outside the repository. The complete scratch path plus 45 bytes must be shorter than 104 bytes because the backend executor uses a Unix socket. Resolve macOS `/var` or `/tmp` symlinks before constructing the fresh scratch path. No dependency installation, download or network-enabled setup belongs inside an isolated run.

`run.mjs` independently pins native revision `15291b87cc90ac0e53b16660760a4318942eb724` and backend revision `8ed1967d9d25c874457cea255961fb04c7db8883`. Its evidence identifies these as integration-owner-supplied revisions and records before/after backend source-byte digests and all executed harness file digests; it does not pretend that environment attestation proves a Git checkout. Native build/config provenance must be checked separately by the launch owner.

## Portable lifecycle

`bootOfficialBackend` in `bootstrap.mjs`, typed by `bootstrap.d.mts`, requires an absolute repository root, fresh short external directory, executable plus its expected hash, exact manifest run ID, supported fixture-set ID, independent backend revision/config version and a mandatory `verifyIsolation` callback. It calls that callback before startup and again before seeding. The callback must independently verify current host isolation; a boolean, environment marker or fabricated receipt is not sufficient for native use.

The fixed numeric-loopback ports are:

| Service | Port |
| --- | --- |
| Official backend | 3210 |
| Official site/card fallback | 3211 |
| Guarded QA gateway | 8199 |
| Strict provider CONNECT fixture | 43128 |
| Provider TLS fixture | 43129 |

The bootstrap copies only `convex/` into private scratch, adds INTERNAL fixture controls and a scratch-only empty cron schedule, creates an empty local database, and pushes with the installed official Convex CLI. It generates local admin credentials, pepper and CA private keys privately. Child environments are allowlisted; inherited deployment/provider credentials are not forwarded. Provider settings are visibly synthetic constants, and `SSL_CERT_FILE` verifies a fresh CA for `verify.twilio.com`; there is no insecure TLS bypass. The CONNECT fixture accepts only that exact host/port, tunnels only to its local TLS server, and validates TLS SNI, Host, fixed Twilio paths, synthetic auth, request fields and reserved fixture actors.

The native launch owner must assemble the following sequence in its own wrapper. Bundle the TypeScript binding/adapter using the installed esbuild; no root package or product configuration change is necessary.

1. Verify independent native/backend/config pins, create a fresh simulator, erase it and establish real PF egress denial. Obtain a receipt plus its independent trusted verifier using the launch/provisioning contract. Revalidate current isolation in `verifyIsolation` rather than trusting the receipt alone.
2. Construct and validate the frozen manifest using the shared adapter manifest parser. Its only application activation values remain `CALLED_IT_QA_RUN_ID` and `CALLED_IT_QA_MANIFEST_BASE64`; do not add a phone, OTP, session token, provider credential or routing source origin.
3. Boot the official backend with the executable hash for the actual platform. Keep its handle private. Do not print, serialize or expose its privileged closures to the app or gateway.
4. Build `officialBackendBinding` with `backendOrigin: local.origin`, the pinned public-function allowlist, `backendSourceRevision`, `fixtureSetID`, `verifyIsolation`, `seedFreshFixture: async (runID, set) => { await local.seedFreshFixture(runID, set); }`, and `dispose: async () => { await local.close(); }`. The binding validates actual imported registration objects and queries the real backend attestation before seeding; source/deployment/config/local-contract mismatches fail closed. Business requests use an unauthenticated official HTTP client with user tokens only in business arguments, never the admin client.
5. Create the guarded adapter in `simulator-runtime` mode with raw manifest bytes, independently pinned expectations, required functions and the real provisioning receipt/verifier. Only this mode can listen. The Linux proof uses `plumbing-unit` mode and cannot listen.
6. If the separately approved bounded card overlay is needed, activate it as described below before serving card-returning requests. Start the gateway only after receipt, attestation and isolation checks succeed. Sign in through actual UI/phone handlers; no session is seeded.
7. Always dispose the adapter, close the local backend and remove private state in a `finally` block. `close()` is idempotent, terminates the backend process group including executor children, closes TLS/CONNECT servers, removes scratch and returns redacted diagnostics. Register any minted session tokens with `local.markSensitive` before retaining diagnostics. The wrapper owns simulator, gateway and PF teardown and must verify those independently.

The bootstrap has no generic remote target, no public fixture endpoint and no exported admin client/key. Both privileged fixture functions are INTERNAL and the gateway allowlist excludes them. `seedFreshFixture` permits exactly one matching run/set against an empty account database. `inspectFixture` is a private diagnostic closure, not an application route.

## Bounded card URL overlay

The real business handler permits only an HTTPS card source, while the frozen native QA manifest deliberately permits only explicit numeric-loopback HTTP destinations. `routing.ts` bridges only this approved synthetic mismatch; it does not alter business authorization or privacy policy.

Create `createBoundedCardRouting` with the validated manifest context, exact separate source pin `https://cards.qa-runtime.invalid`, and the SHA256 of the actual executed `routing.ts` bytes. Pass it as `routingOverlay` to the binding. After adapter creation, query the guarded QA attestation using the actual run/hash request headers, then call `overlay.activate({ receiptPath, verify, attestation })` with the real trusted provisioning verifier. Record `overlay.provenance()` alongside source/config/build pins. Activation checks the exact local V0 attestation, run, raw manifest hash and independently verified receipt. It does not replace ongoing OS-isolation verification.

Rewriting is disabled before activation and after manifest expiry. Only the canonical `card.url` on get/create results or each list/history item is eligible. The original must exactly match the pinned HTTPS source plus `/c/<64 lowercase hex>`; foreign origins, credentials, ports, query, fragment, encoding, normalization and extra paths are rejected. Only the origin changes to the already validated manifest `cardOrigin`; the locator and all other fields remain unchanged. There is no recursive rewrite, fetch proxy or redirect.

The routing unit tests use explicitly fake receipt/verifier fixtures. They prove bounded behavior, not simulator erasure, PF, native transport or real overlay activation. Never promote those fixtures to runtime evidence. Credit a real activation only as synthetic-loopback QA plus a routing overlay, not production HTTPS, physical-device transport or install-return behavior.

## Fixture catalog

Every supported set starts with the same minimal baseline: four accounts and verified-phone rows, no sessions, G1 with creator/friend/subject, G2 with creator/friend/outsider, memberships older than bets, an open subject bet, a voided unavailable bet and friend board points 17/4. These points are read-only fixture values, not earned-scoring evidence.

| Role | Reserved synthetic phone | Alias |
| --- | --- | --- |
| friend | +12025550101 | QA Finn |
| outsider | +12025550102 | QA Oli |
| subject | +12025550103 | QA Sage |
| creator | +12025550104 | QA Cora |

The exact manifest run-ID spelling appears in `SECRET_QUESTION_<runID>`, `PRIVATE_OPTION_A_<runID>`, `PRIVATE_OPTION_B_<runID>` and `PRIVATE_CONTEXT_<runID>`. Locators are actual SHA256 values for `<runID>:bet-a` and `<runID>:unavailable`. The yes/no and over/under sets use their real format options instead of the private-option strings. Sealed/unavailable assertions must prove those values are absent, not just take a screenshot.

Supported IDs are `synthetic-v0-subject-locked`, `synthetic-v0-subject-veto`, `synthetic-v0-host-handoff`, `synthetic-v0-account-switch`, `synthetic-v0-unknown-conversation`, `synthetic-v0-controls`, `synthetic-v0-preferences`, `synthetic-v0-board-g1`, `synthetic-v0-board-g2`, `synthetic-v0-friend-yes-no`, `synthetic-v0-friend-over-under`, `synthetic-v0-friend-this-that`, and `synthetic-v0-unavailable`. Naming a set selects baseline/format inputs; it does not certify the named UI journey. Create/pick/scoring remain `POLICY_PENDING` where the real backend requires policy approval; the harness never forges successful policy-pending flows.

## Linux handler proof and checks

From the repository root, supply a fresh external evidence directory and the separately downloaded pinned Linux x64 executable:

```sh
env -i PATH="$PATH" HOME="$HOME" node tests/qa-runtime/run.mjs \
  --binary "$HOME/.capy/work/cons13-local/toolchain/convex-local-backend" \
  --output "$HOME/.capy/work/qa-runtime-FRESH-UNIQUE-ID"
```

The runner creates a fresh user/network namespace with only loopback, verifies no IPv4/IPv6 default routes, and invokes actual handlers through official HTTP clients and the guarded in-process adapter. It checks independent real-backend and gateway attestations, exact fixture identity and empty-session baseline, INTERNAL-control exclusion, rejection of an untrusted provider certificate, four real phone sign-ins, retry idempotency, wrong-code denial, replay conflict, authenticated identity, sealed-subject privacy, eligible/outsider separation, unavailable privacy, separate read-only group boards and unchanged pick/ledger counts after `POLICY_PENDING`.

The runner intentionally does not activate routing: native-card-origin compatibility remains explicitly blocked. Its manifest is only a plumbing contract input with a placeholder simulator, not a native activation. Evidence retains `nativeUIExecuted=false`, `simulatorProvisioned=false`, `nativeTransportCredit=false`, `realProviderExecuted=false` and `fullV0Ready=false`. A passing evidence file is insufficient unless the command exits zero, private state is removed, and the source/harness hashes remain unchanged.

NaN and both infinities are valid Convex wire values, not valid confidence inputs. The native codec test checks their exact `$float` encoding and exclusion from the actual control range; this real-backend lane separately sends all three through the official HTTP client and requires `INVALID_INPUT` with unchanged fixture counts. This is not a claim that Swift has called the backend or that a pick succeeded.

Run focused verification without inherited deployment credentials:

```sh
env -i PATH="$PATH" HOME="$HOME" node node_modules/eslint/bin/eslint.js tests/qa-runtime
env -i PATH="$PATH" HOME="$HOME" node node_modules/typescript/bin/tsc \
  --ignoreConfig --noEmit --strict --skipLibCheck --target ESNext --module preserve \
  --moduleResolution bundler --lib ESNext,DOM --types node --allowJs \
  tests/qa-runtime/binding.ts tests/qa-runtime/routing.ts tests/qa-runtime/routing.test.ts \
  tests/qa-runtime/vitest.config.ts tests/qa-runtime/bootstrap.d.mts
env -i PATH="$PATH" HOME="$HOME" CI=1 QA_ADAPTER_TEST_ISOLATED=network-namespace-v1 \
  unshare --user --map-root-user --net node node_modules/vitest/vitest.mjs run \
  --config tests/qa-runtime/vitest.config.ts
```

These commands do not build or drive native UI. The portable bootstrap/binding are reusable on macOS, but the `unshare` runner is Linux-only. Native launch orchestration, actual trusted receipt generation, current PF verification, build/config provenance and simulator/UI assertions belong to the launch owner.
