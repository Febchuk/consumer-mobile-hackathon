# Fresh cloud Mac simulator provisioner

Test-only source. No Mac/PF mutation, simulator, Messages launch, phone action or
remote build has been executed by this child. Linux unit results are not kernel
or native behavior evidence. The first actual cloud command should be the bounded
**enforcement probe**, not the full UI lane.

Parent-reported capability baseline: build `01M7KBX2SZK3PVFVPTHYRNFDNP`,
2026-11-16 23:43:55 UTC, macOS 26.6.2 / Xcode 27, effective UID 501,
`sudo -n pfctl -s info` / `-sr` succeeded, PF disabled with zero states, root
`anchor "com.apple/*"`; sandbox-exec exists. ALTQ warnings were nonfatal. Those
reads establish capability only. This implementation does not assume another
account, an external responder/DNS service, dylib injection or launcher sandbox
inheritance.

## Exact cloud commands

First prepare a fresh private absolute request JSON and choose the actual runner
controller PIDs from the Mac's independently observed established sockets. Do not
invent PIDs or preserve all host connections. `request.example.json` is a
**non-runnable template** until its pins/paths/PIDs are replaced.

From the repository root on the approved fresh cloud Mac:

```sh
/usr/bin/python3 -E -s tests/simulator-provisioner/provision.py \
  --request /absolute/qa-run-request.json \
  --output /absolute/new-enforcement-probe-directory \
  --trusted-launch-context /absolute/parent-proof/launch-context.json \
  --trusted-launch-sha256 "$TRUSTED_LAUNCH_SHA256" \
  --enforcement-probe
```

This installs only a run-owned global PF child anchor/enable reference, verifies
existing controller traffic, literal loopback TCP/UDP, actual IPv4/IPv6 kernel
drops and a uniquely attributable blocked system-resolver query, then restores
owned isolation. It never creates/boots a simulator or emits a native manifest or
provisioning receipt. Independent cleanup must be read even if the probe fails.
It ignores build-artifact paths because it makes no native/build claim.

A read-only inspection alternative is the same command with `--inspect-only`
instead. That also validates the actual independent built artifacts and never
loads PF rules.

After the enforcement probe actually passes and the parent supplies its existing
backend/runtime argv wrappers plus a built `.xctestrun` containing the new driver:

```sh
/usr/bin/python3 -E -s tests/simulator-provisioner/provision.py \
  --request /absolute/qa-run-request.json \
  --output /absolute/new-full-runtime-directory \
  --trusted-launch-context /absolute/parent-proof/launch-context.json \
  --trusted-launch-sha256 "$TRUSTED_LAUNCH_SHA256" \
  --backend-command /absolute/backend.argv.json \
  --runtime-command /absolute/native-scenarios.argv.json \
  --xctestrun /absolute/built/CalledItMessages_iphonesimulator.xctestrun \
  --fixture-phone +12025550101
```

The fixture phone is UI-test input only; choose the binding owner's actual
reserved actor. It is never an app configuration/manifest field. UI types code
`000000` over the actual native transport. There is no token or OTP injection.

## Request and owner integration

The request has exactly `runID`, `nativeSourceRevision`, `backendSourceRevision`,
`fixtureSetID`, `configVersion`, `runtimeID`, `deviceTypeID`, `apiPort`, `cardPort`,
`lifetimeSeconds`, `appPath`, `nativeBuildRecord`, `backendBuildRecord`,
`controlPIDs`, `sourceCardOrigin`. Pins must be actual independent 40-lowercase-hex
build revisions; runtime/device IDs must exist on that Mac. Current coordinated
ports are official backend 3210, API gateway 8199 and card site 3211.
`sourceCardOrigin` is exactly `https://cards.qa-runtime.invalid` (no alternate,
trailing slash or normalization) for
the parent-owned strict routing overlay. It is recorded in provenance/context,
never added to the frozen native manifest or used as a redirect/fetch endpoint.

Each independent build record has exactly `sourceRevision`, `artifactPath`,
`artifactSHA256`, `buildID`. The native artifact path is the actual host
executable. Built host/extension bundle IDs, QA channel, fixtureMode=false,
App Group, source revision, executable and Info.plist hashes, SDK/build versions
are independently checked; installed host/extension executable hashes must match.
Inputs/output paths must be absolute, non-symlink and fresh where required.

Each owner command file is a JSON argv array whose first entry is an absolute
real executable (resolve symlinks first). Shell/sudo identity wrappers and secret
arguments are not supported. Use a small explicit Python/Node executable wrapper,
not shell text. This provisioner does **not** invent the backend binder's CLI.
Both owner wrappers receive only the explicit clean environment plus
`CALLED_IT_PROVISIONER_CONTEXT`, pointing to `context.json`, which contains the
request, exact UDID, manifest/receipt paths and hashes, and lease expiry.

The backend wrapper must start and supervise the real official backend/provider
fixture/gateway/site at the coordinated loopback ports, read the real receipt via
the adapter's **separate trusted provenance verifier**, and stay alive. The
provisioner supplies no auto-approval verifier, stub handlers or provider delivery
claim. The native wrapper runs parent-selected actual scenario assertions and
returns nonzero on any blocked/failed dependency. Wrappers must keep descendants
in their registered process group, supervise/await them and never daemonize.
No dependency download or other nonlocal connection may be needed after lease
activation. Generic owner stdout/stderr is not captured, to avoid logging
credentials; owner wrappers must provide their own public-safe result artifacts.

## Mandatory trusted-launch provenance

PF capability is not permission. Every mutating entry requires the parent-pinned
`--trusted-launch-context` and its exact raw-byte SHA256. A generic/local/paired
entry, an `exclusive:true` input, hardware traits or an arbitrary provisioning
receipt cannot authorize mutation. The parent supplies these nonsecret captures;
the harness does not manufacture an admission claim or invent a signing API.

The context JSON has exactly `version:1`, canonical `runID`, canonical unique
`launchNonce`, and three `{file,sha256}` references: `reviewedAuthority`,
`toolLaunchRecord`, `sourceManifest`. Referenced files are bounded regular
non-symlink basenames beside that context. Use the actual reviewed authority
snapshot at Captain Drive `handoffs/CONS-13/remote-runner-isolation.json`;
its embedded readable provider source must hash to
`24c2eacdef14a2d9ae80a3aa7a83851d209ef4b8b379f9df479890f9305fadd5`.
This provider/route guarantee is necessary but not a per-job witness by itself.

The source manifest is `{version:1,launchNonce,files:{"relative/path":sha256}}`.
It must seal all runtime guard files listed in `launch_provenance.REQUIRED` and
any additional sources the trusted parent archives. Every actual archived file
is rehashed. No arbitrary source root, traversal or inferred revision is accepted.

The parent-observed launch record has exactly `version:1`,
`observer:"trusted-parent-launcher"`, `tool:"mobile.build"`,
`provider:"revyl-remote-builds"`, `runID`, `launchNonce`,
`sourceManifestSHA256`, `capturedAt` (epoch milliseconds), `bootSessionUUID`,
`invocation`, and `result`. `invocation` is the actual captured nonsecret tool
input (`action:"start"`, `platform:"ios"`, `source.type:"workspace"`); its archived
commands bind the exact unique nonce and source-manifest hash. `result` includes
the real returned 26-character `build_id`, not a placeholder/prior build. The
current guest `kern.bootsessionuuid` is independently read and must match the
recorded actual boot identity before mutation. The capture must be current.
The unique nonce is consumed once by the independent root guard.

The trust boundary is the parent's observed tool invocation/result and pinned
archive/proof hashes, not facts asserted by the app, API caller or receipt. The
parent must stage the actual per-job record before this command; this directory
does not generate a fake record or claim cryptographic platform attestation.
The verified nonsecret chain is written to `runner-launch-chain.json` and
`runner-authorized.json` **before** any firewall change. Missing/unbound chain
fails closed even on a Mac with working sudo/PF.

## Gateway verifier/controller interface

`controller.ts` exports:

```ts
createLiveProvisioningController({
  contextPath,
  expected,
  expectedHarnessSources,
  expectedSourceCardOrigin: "https://cards.qa-runtime.invalid",
}) // => { verify: ProvisioningVerifier, assertLiveIsolation: () => Promise<void> }
```

`expected` is the existing adapter's independently supplied `ExpectedRun`.
`expectedHarnessSources` is the trusted archived map of basename -> SHA256 for
the actual `.py`/`.ts` guard sources, never copied from a receipt under test.
The parent can capture the source map before launch with
`python3 tests/simulator-provisioner/status.py --fingerprint-only`, then bind it
to the actual observed archive/source manifest. Both callbacks query the real
root lease process/birth, live PF root/child trees and empty state table,
heartbeat, platform launch chain, actual blocked DNS packet, independently
erased fresh-device record and current source hashes. A file-only live flag or
Linux plumbing fixture cannot pass. The verification callback additionally
checks all four receipt artifacts and actual raw-manifest/source/origin pins.

Use `verify` as the existing adapter's explicitly selected trusted provenance
verifier and the mandatory `assertLiveIsolation` closure for the composition
owner's lifetime checks. The adapter still performs its own receipt integrity
validation. No default verifier approves arbitrary artifacts, and no binding
CLI or business fixture is fabricated here.

## Enforcement and lifecycle

1. `lease.py` is an independent root process in its own session, started through
   noninteractive sudo. It re-reads real established controller tuples, requires
   the observed disabled-PF/empty-state baseline and supported root ordering,
   verifies/logs the mandatory trusted launch chain, rejects unreviewed nested
   filtering/translation, parses its rules with `pfctl -n`, and loads only its last-sorted
   `com.apple/zzzz_calledit_<run>` child, and obtains its own `pfctl -E` token.
2. Each bidirectional existing controller exception matches the exact numeric
   local/remote address and port with `flags any no state`. Existing TCP may be untracked
   because PF starts disabled: there is no SYN requirement and no broad endpoint
   exception. Literal 127.0.0.1/::1 loopback passes are also stateless. All other
   inbound/outbound traffic, every UID and privileged broker included, is denied;
   new inbound state cannot create an egress fast path.
   Unexpected PF states or changed root/nested/owned filtering, translation or
   anchor order abort the run. Unreviewed existing child/nested rules are refused
   before mutation, not overwritten.
3. `netprobe.py` requires positive matched controller counters and real loopback
   echoes. TEST-NET/documentation IPv4/IPv6 TCP/UDP attempts must increment their
   own destination/protocol-specific kernel drop counters. No-route, EPERM or a
   timeout alone is unproven. No external responder is contacted/required.
4. The system resolver is invoked with a unique nonce under IANA example.com.
   A nonce-filtered PFLOG capture must contain that exact query as `block out`,
   and the live DNS-deny counter must advance. Cached NXDOMAIN, resolver failure
   or an absent packet is blocked, never proof. PFLOG is created only if absent
   and removed only if this run created it; capture persists only the exact owned
   nonce, not unrelated DNS/history. Unsupported PFLOG/tcpdump behavior fails.
5. Only then does the provisioner create a new named simulator, explicitly erase
   it, register its actual metadata/UDID with the independent lease, and boot.
   It checks real system-app inventory, empty run-owned Messages/Contacts counts,
   no prior QA activation, exact OS build, then installs the real built app and
   embedded extension. No existing simulator or personal database is reused.
6. Four hashed actual backing records feed the existing adapter receipt contract:
   simulator-created, simulator-erased, empty-state-verified, outbound-denied.
   The exact frozen native manifest is emitted only under the live verified
   lease, with expiry shortened to fit that lease. Manifest booleans are outputs
   of the command/kernel checks, not accepted input overrides.
7. `job.py` waits for independent registration/approval before exec. The lease
   verifies each new process group's actual UID, parent, group and birth before
   approving it. Parent death, missing heartbeat, changed kernel policy or the
   monotonic deadline triggers stop-before-release cleanup. At most eight jobs
   are accepted. Authoritative process snapshots track descendants; identity-query
   failures never grant permission to signal. Escaped or unattributed surviving
   descendants retain isolation instead of trusting a wrapper exit. Every external
   command has a timeout; the missing-heartbeat
   threshold is eight seconds plus bounded command/cleanup time.
8. Cleanup stops only registered workload groups and the exact verified run-owned
   simulator, then flushes only the owned anchor's **rules** and releases only its
   `-E` reference with `-X`. No global state flush, `pfctl -d`, root-policy rewrite,
   arbitrary process kill or other simulator erase occurs. Unproven workload or
   device termination retains isolation and records administrative cleanup needs.
   Actual rules, PF status/state, anchor inventory and PFLOG presence are queried
   again after cleanup and recorded, including an inert namespace if the kernel
   retains it. `completed.json` is written only after observed successful cleanup.

Future controller reconnects/DNS are intentionally not granted broad exceptions.
The exact existing control flow must actually carry packets in both directions
under the rule; if
that cannot be demonstrated, boot is refused. A controller that needs a fresh
connection mid-run may wait for bounded cleanup. IPv6-only control currently fails
before mutation because neighbor-discovery preservation has not been independently
reviewed; no silent broad ICMPv6 exception is added. This is a real runner constraint,
not something to hide by allowing arbitrary external traffic.

## Separate native UI driver

`drive.py` makes a NEW external `.xctestrun`, preserving the original build file
and selecting only `ProvisioningDriveTests` on the exact UDID. Its test-runner
activation is the real frozen manifest; the actual host receives only the normal
two launch activation fields. The driver signs in through actual phone/code UI,
launches real MobileSMS, composes only to reserved +12025550198/+12025550199,
opens the actual embedded Called It extension and checks matching attested
run/manifest/shared-session diagnostics. It never taps Send, selects prior
threads/contacts, signs into Apple or substitutes a fake Messages/host wrapper.
Unknown system selectors, missing extension support or shared Keychain capability
fail with specific assertion IDs and a run-owned xcresult.

This prepares a synthetic compose/capability surface, not an existing delivered
message/card or every scenario fixture. The parent still owns actual business
fixture/conversation/card setup and assertion selection. Production HTTPS/card
transport, SMS/APNs delivery, physical forwarding/privacy, distribution and
install-return remain separate blocked lanes.

## Local checks and evidence boundaries

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s tests/simulator-provisioner -p 'test_*.py' -v
node --test tests/simulator-provisioner/controller.test.mjs
node node_modules/typescript/bin/tsc --project tests/simulator-provisioner/tsconfig.json
```

Units use explicitly fabricated command/process/PF/receipt inputs; they perform
no Mac/PF/phone action and are not simulator proof. Read `blocked.json`,
`lease-blocked.json`, `lease-cleanup.json`, `network-probe-stderr.txt` and the UI
xcresult for actual cloud failures. Global enforcement remains unexecuted until
the parent runs the command above. A successful preflight or passing units cannot
be promoted to outbound, UI, provider, signing or full-V0 readiness evidence.


Current local assertion inventory: Python `SIM-AUTH-01..03`, `SIM-GUARD-01..07`,
`SIM-EGRESS-01..09`, `SIM-GATE-01`, `SIM-LEASE-01..08`, `SIM-RECEIPT-01..02`,
`SIM-UI-01..02`, `SIM-CLEANUP-01` (33 methods), plus Node
`SIM-CONTROLLER-01..02`. The separate native driver uses
`SIM-PROVISION-UI-01..16`; those native assertions are source-only until the actual
Mac UI lane runs. Unit receipt/process/packet inputs are deliberately fabricated
and cannot be reported as real platform, kernel, simulator or Messages evidence.
