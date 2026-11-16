# Native assertion sources

**Blocked/unexecuted:** this Linux machine has no Swift, Xcode or iOS simulator.
No test compilation/execution, network request, remote build, pairing, personal
Messages navigation or send has been performed. Source checkpoint inspected:
`c3250ca`, integrated at `9c47fbd`. A source assertion is not a passing test.

## Actual target and source membership

`CalledItCoreTests` is the existing hostless iOS XCTest target. Its sources are
exactly `Shared/`, `Tests/`, `TestSupport/`; `TEST_HOST` and `BUNDLE_LOADER` are
empty. Tests call real Shared implementations directly, without a test-local
decoder/router/session implementation or an invented product import. No `App/`
or `Extension/` symbol is currently assumed present in that target.

`CalledItUITests` compiles `UITests/` and `TestSupport/` against the actual host.
Use existing scheme `CalledItMessages`, configuration `QA`. Actual QA IDs are
host `com.mikunad.calledit.qa.host` and extension
`com.mikunad.calledit.qa.host.messages`. Existing test bundle IDs are
`com.mikunad.calledit.messages.coretests` and `.uitests`; neither is an app target.
Release excludes test/support sources. Native owns all project/config edits.

Old d23f9e7 Cards/Links/Config tests and old test contract are preserved under
`tests/baseline/native/` for archaeology only. They are **not** target sources and
refer to removed APIs. Their old `CALLEDIT_QA_*` contract is not the active seam.

## Real Shared assertions

| Source | Assertion IDs / what is checked |
|---|---|
| `RuntimeConfigurationTests.swift` | `NATIVE-CONFIG-01..12`, `NATIVE-ATTEST-01..03`: required typed config, independently pinned native/backend revisions, exact HTTPS hosts, no ordinary fixture/HTTP bypass, matching v0.2 attestation; normal mode rejects test adapters |
| `CardLocatorTests.swift` | `NATIVE-LOCATOR-01..08`: actual opaque `/c/<locator>` round trip; wrong origin/scheme/port/query/fragment/credentials/encoded path tricks rejected; decoded persisted values revalidated before use |
| `SharedSessionAndLinksTests.swift` | `NATIVE-SESSION-01..02`, `NATIVE-LINK-01..05`, `NATIVE-CLEAR-01..03`: strict session expiry/account/token/environment; no last-room fallback; account/conversation separation; explicit unlink; targeted cache/pending-locator cleanup |
| `NativeBetTests.swift` | `NATIVE-LOCK-01..09`, `NATIVE-FORMAT-01..08`, `NATIVE-PICK-01..03`, `NATIVE-VARIANT-01..02`: real sealed/unavailable/bet decoder, absent private keys even when null, two outcomes across canonical formats, bounded confidence and invalid variant/state rejection |
| `ClockNotificationAndProofTests.swift` | `NATIVE-CLOCK-01..03`, `NATIVE-NOTIFY-01..03`, `NATIVE-PROOF-01..05`: monotonic countdown is not reveal authorization; known neutral notification navigation; actual `$bytes` decoder, exact 512 KiB bound, no public URL fallback |
| `NativeQAGateTests.swift` | `NATIVE-QA-01..12`: independent **runner safety gate**, not product QA seam coverage; raw manifest hashing, exact fields, numeric loopback, bounded lifetime/size, matching simulator/run and credential rejection |
| `APITransportTests.swift` | `NATIVE-TRANSPORT-01..03`: actual API rejects legacy paths, unsupported kind and client `now` before bundle/config/network. HTTP/envelope scenarios depend on the owner seam below |

Pure model unit fixtures use reserved `.invalid` URLs and fresh UUID-namespaced
UserDefaults suites. They do not call API transport, SessionStore/Keychain or
Messages. Suite deletion is limited to the suite the test created. The deliberately
unregistered unit Keychain string is never used for a Keychain operation and is
not a claim of registered entitlements. Installed QA apps must use the fixed real
QA entitlement groups, not these unit-only configuration values.

Two expectations intentionally capture stricter privacy/schema requirements
that current source inspection does not satisfy: sealed DTOs containing
`token`/`proof`/`proofMediaId` must reject (`NATIVE-LOCK-09`), and `over_under`
without `line` must reject (`NATIVE-FORMAT-08`). No execution result is claimed.

## Pending exact transport and host seams

At c3250ca, `API` has a private static URLSession/private request decoder and
loads Bundle.main internally. The native owner is adding a configuration +
URLSession overload of **the same `API.run` path**. Tests must wait for its real
signature. Do not register a global URLProtocol, copy the envelope decoder, bypass
attestation or mutate Bundle.main. An injected ephemeral URLSession will use a
strict custom URLProtocol that rejects all requests it cannot satisfy locally.
No request from that lane may leave the process.

Required transport cases: real request method/path/header/body; supported Convex
`format:"convex_encoded_json"` and `args:[convexToJson(args)]` equivalent;
structured object, JSON-string and null `errorData`; documented non-200 UDF
error status/envelope; malformed success, HTML proxy 4xx/5xx, offline, valid
success/null, attestation mismatch and authenticated 512 KiB `$bytes` request/
response round trip. Assertions must exercise the real encoder/decoder, not a
test implementation. `v0Auth:redeemPair` is an **action**. URLProtocol tests are
transport **units**, not real Convex HTTP/provider evidence.

`HostAuthenticationModel` lives at `App/HostAuthenticationModel.swift`, outside
the current unit target. Owner request: add that exact file (not `CalledItApp.swift`
or notification/UI entry points) to `CalledItCoreTests`. Native is also publishing
configuration/session-persistence injection with the real secure defaults retained.
Wait for actual signatures before writing call sites. Then use `PhoneAuthenticating`
protocol mocks only for view-model tests: normalize/reject phone input, busy state,
failed/expired code, verified session persistence, account-switch cleanup,
`AUTH_REQUIRED` cleanup versus `POLICY_PENDING` preservation, and pending locator
continuity. No fake OTP service is backend E2E evidence; no hostless test should
read Bundle.main credentials or a real Keychain access group.

Actual MSMessage serialization/artwork and bet-specific MSSession selection still
live in `Extension/AppModel.swift`, outside Shared-only unit membership. Need a
native-owner rendering target or explicit real-source observation seam for these
assertions. Do not import obsolete Cards APIs, fabricate `qa.draft.*` verdicts or
infer session binding from a host launch. The `Get the app` copy is now present
in actual Cards.message source; rendering/transport remains unverified.

## Exact UI launch contract and blocked dependencies

The active contract is Captain handoff `handoffs/release-v0/qa-launch-contract.md`.
The runner passes only `CALLED_IT_QA_RUN_ID` (UUID) and
`CALLED_IT_QA_MANIFEST_BASE64` (at most 16,384 decoded raw JSON bytes) to the QA
host. It hashes the **raw** decoded bytes. The manifest pins native/backend source,
run/simulator/deployment/config/fixture set, issue/expiry and explicit isolation
claims; origins are only `http://127.0.0.1:<1024..65535>`. This HTTP exception is
only for a validated simulator QA seam; release card locators remain HTTPS.
The runner does not inject a token, phone or OTP in configuration.

The external provisioner must actually create/erase a dedicated simulator,
record installed bundle/OS/UDID evidence, and open the actual embedded extension
in a synthetic conversation. Manifest booleans do not prove these facts. The
suite never launches Messages, searches contacts/inbox/history, pairs or sends.
It activates MobileSMS only if it is already running after this provisioning.

The QA host validates and shares the activation using the fixed QA App Group;
the extension must revalidate it, not depend on MobileSMS inheriting environment.
The adapter must deny outbound network, handle actual `/api/query|mutation|action`
transport against isolated real handlers, and attest matching raw-manifest hash
and run headers with `testAdapters:true`. No public seed/reset/time routes are
invented here. Sign-in uses actual API transport to a synthetic local provider;
the UI fixture provider uses reserved synthetic numbers and code `000000`.

`MessagesDriveTests.swift` uses actual native IDs (`bet.sealed`, `bet.question`,
`bet.option.0/1`, `bet.confidence`, `bet.savePick`, `bet.veto`,
`bet.revealWithoutRubbing`, `auth.*`, `navigation.*`, `settings.*`, `board.row.*`).
Published QA diagnostics are `qa.runtime.buildChannel/bundleID/fixtureMode/`
`endpointPolicy/sessionStorage/runID/manifestSHA256/simulatorUDID/fixtureSetID/`
`attestationState/apiOrigin/cardOrigin`. At c3250ca only the first host diagnostics
exist; full manifest-bound diagnostics, actual adapter and provisioner are still
blocked pending the native seam commit. Missing fields fail, never skip.

Run one UI method per matching manifest `fixtureSetID`:

- `synthetic-v0-subject-locked`, `synthetic-v0-subject-veto`: locked tree/privacy
  and one-tap unavailable result (`NATIVE-UI-LOCK-*`, `NATIVE-UI-VETO-*`). Backend
  outbox assertions separately prove veto is quiet; UI text alone does not.
- `synthetic-v0-friend-yes-no/over-under/this-that`: two options, save/edit/readback
  acknowledgement and <10 seconds (`NATIVE-UI-FORMAT-*`, `NATIVE-UI-PICK-*`).
  Durable pick count/account/version needs independent handler/store assertions.
- `synthetic-v0-reveal-active`, `synthetic-v0-unknown-conversation`: actual polling,
  accessible reveal and explicit group selection (`NATIVE-UI-REVEAL-*`, `CHAT-*`).
- `synthetic-v0-host-handoff`, `synthetic-v0-account-switch`: pending card,
  transported synthetic phone sign-in/shared session and stale-content denial
  (`NATIVE-UI-AUTH-*`, `ACCOUNT-*`). Fixture setup must retain the original selected
  card; no automatic after-install return is assumed.
- `synthetic-v0-controls/preferences/board-g1/board-g2`: real control IDs,
  acknowledged no-bets and independent read-only seeded board values
  (`NATIVE-UI-CONTROLS-*`, `PREFERENCES-*`, `BOARD-*`). Values 17/4 assert rendering,
  not an approved scoring formula. “QA Finn” is the synthetic row alias.
- Session-binding/rendering, suspended reveal observation, app-absent fallback,
  and actual install-return methods contain explicit `NATIVE-UI-*-BLOCKED`
  failures until their real observation/provisioning contracts exist. They must
  not be removed from the evidence inventory or counted as passes.

Question fixture marker is `SECRET_QUESTION_<manifest runID>`; private This/That
options are `PRIVATE_OPTION_A_<runID>` and `PRIVATE_OPTION_B_<runID>`. Context,
proof and synthetic token markers are defined in `NativeQARun`. Use no real data.

## Mac invocation after owner seams/provisioning land

```sh
cd native-imessage
xcodegen generate
xcodebuild test -project CalledItMessages.xcodeproj -scheme CalledItMessages \
  -configuration QA -destination "platform=iOS Simulator,id=$QA_SIMULATOR_UDID" \
  -only-testing:CalledItCoreTests -resultBundlePath "$ARTIFACTS/native-core.xcresult"
```

For UI, forward the two approved activation variables into the XCTest runner,
prepare exactly one fixture set/actual extension, then select one method with
`-only-testing:CalledItUITests/MessagesDriveTests/<method>`. The current scheme
does not yet document runner-variable forwarding; native owner must supply it.
Record exact candidate/backend/config/fixture/UDID/OS and `.xcresult` evidence.
No green unit lane substitutes for signed shared storage, three-phone forwarding/
privacy, provider OTP/APNs, app-absent transport or real distribution evidence.
