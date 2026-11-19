# Native journeys on a Mac simulator

One command builds the QA app, starts the repository's real backend handlers on loopback with synthetic people, and runs the UI tests in a simulator it creates and deletes itself:

```sh
export PATH=/opt/homebrew/bin:$PATH   # Node 24, xcodegen
node tests/native-sim/run.mjs
```

Options: `--only <Class[/test]>` (repeatable), `--output <new directory>`, `--runtime`, `--device-type`, `--keep-simulator`, `--backend-only`, `--demo`. The evidence directory holds `evidence.json`, `build.log`, `test.log`, `backend.log` and `native-ui.xcresult`.

To click through the app by hand with seeded data, run `tests/native-sim/demo.sh`. It opens a fresh simulator with fresh data, lasts at most 60 minutes, and removes both when it ends. Return in its terminal relaunches the app.

## What it does and does not guarantee

- The simulator is always new, named `CalledIt-QA-<run>`, and the runner refuses one that has an Apple account. It never touches other simulators or devices.
- The backend is the pinned Convex local backend (`tests/qa-runtime/binary-pins.json`) on 127.0.0.1 with the handlers from `convex/`. Sign-in codes come from a loopback fake; the runner points a scratch copy of `convex/v0AuthProvider.ts` at it because the macOS backend ignores `SSL_CERT_FILE`. The repository source is not changed.
- The built app is refused if it carries an endpoint of its own; it only reaches the gateway named in the run manifest.
- Outbound network is observed, not denied. Nothing on this lane blocks traffic (that needs root), so its manifest says `outboundNetworkDenied: false, outboundNetworkObserved: true`, the app shows `observed_not_denied` in its QA diagnostics, and `evidence.json` carries `networkIsolation: "observed"`. The QA runtime accepts that mode only in a QA build on a simulator with both origins on loopback; the root provisioner lane (`tests/simulator-provisioner`) still requires denial. Simulator system services do reach Apple and the evidence lists them. The runner samples established connections every five seconds and fails the run if the app, its extension or its test runner holds one that is not loopback; a connection shorter than the sampling gap can be missed.
- `MessagesDriveTests` and `ProvisioningDriveTests` belong to the provisioner lane and need its fixtures. A default run skips them and lists them as blocked in `evidence.json`.
- Ctrl-C or a termination signal still deletes the simulator, stops the backend (also while it is starting) and writes the evidence. A signal that arrives during the Xcode build is handled when the build step returns.
- The demo and the tests share fixed loopback ports (3210, 3211, 8198, 8199, 43128), so only one can run at a time.

## Slow machines, retries and latency budgets

- `--wait-scale <1-8>` stretches every wait in the test helpers for a slower machine such as a hosted runner. Waits are on real conditions (an element exists, can be touched, a value is held); the scale only bounds how long they may take.
- Typing is verified: after typing, the helper checks the field holds exactly that text and retypes if not. Messages gets one relaunch if it does not reach the foreground. Each of these is written to `retries` in `evidence.json`, and a run that needed any is reported as `passed-with-retries`, never `passed`.
- Product latency budgets (a pick confirmed within ten seconds) are always measured into `latencyBudgets.measurements`. They fail a test only with `--reference-hardware`, which cannot be combined with a wait scale; `latencyBudgets.mode` says which mode a run used.

## Known simulator limits

- Messages on a simulator has no account, so no message is ever sent; tests use its built-in synthetic conversation.
- Messages reports a new conversation identity after it is relaunched, so a group link does not survive quitting Messages. Tests that need "close and come back" reopen the screen instead, and the relaunch case stays blocked.

## Coverage bindings

`tests/coverage/native-bindings.json` binds native-layer (`.U`) assertions from `inventory.json` to `NATIVE-UI.<Class>.<test>`. These are proven only by a passing run of this command; they live outside `bindings.json` because that file is checked to hold backend (`.B`) evidence only, so the backend evidence report still shows them blocked.

## Full runs are split into parts

A QA activation lasts at most one hour and the whole suite takes longer. A run without `--only` therefore runs the journey classes in parts. Each part is a complete run with its own simulator, backend and activation, and writes its own evidence under `part-<n>/` in the output directory. The top-level `evidence.json` lists the planned parts, each part's status, commit, simulator, test cases, latency measurements and retries, and the totals. The combined status is never better than the worst part, and a part that did not run or wrote no evidence makes the run `blocked`. Every `JourneyCase` class in `native-imessage/UITests` lands in exactly one part; a class with more than 16 tests stops the run before anything starts.

## Failed calls, injected faults and fixture retries

- The gateway records every app call that ends in an error with no product code: the server's message, the HTTP status, the caller and the test. They are in `appCallFailures` in `evidence.json` and beside the call in a failed test's `JOURNEY-DIAGNOSTIC calls` line.
- A test can make the app's next calls to one public function fail with `control.failNext(path, count:)`. The gateway answers them itself with a codeless server error, logs them with outcome `injected`, and `reset` clears what is left. `ResilienceJourneyTests` uses this to prove the app retries a failed load by itself and otherwise shows the error with "Try again".
- Under load the local backend can exceed its one-second function limit. A fixture call that times out changed nothing, so the harness repeats it up to twice and records each repeat as a `fixture-retry`. Like every retry, it turns a pass into `passed-with-retries`.
- Before the build and again before the tests start, the runner waits until xcodebuild offers the run's simulator as a destination. A test start that still cannot find it is repeated once and recorded as a `destination` retry.
- A second tap on a conversation Messages ignored is recorded as a `retap` retry.
- Cancelling an empty "New Message" draft that Messages opened on is recorded as a `draft-cancel` retry.

## One retry of a failed test, for slow shared runners only

`--retry-failed-once` is off by default. With it, each test that failed is run once more, by itself, in a new xcodebuild session; the test's own set-up ends both apps and resets the backend, so nothing of the first attempt is left.

- A test that passes on its second attempt counts as passed, with `attempts: 2` and its first failure in `tests.cases`, a `test-retry` entry in `retries`, and a record in `tests.testRetries` holding both attempts' messages and result bundles (`native-ui.xcresult` and `native-ui-retry-<n>.xcresult`; the second attempts' output is `test-retry.log`). The run reports `passed-with-retries` and names the test.
- A test that fails twice fails the run.
- `tests.testRetryCounts` (and `testRetryCounts` in a combined run) maps each retried test to how often it needed the retry, so a test that needs one repeatedly across runs can be found by adding these up.
- A failed test is not retried when the QA activation has less than eight minutes left; it is listed in `tests.notRetried` and stays failed.
- The option is refused together with `--reference-hardware`. The reference run on a real Mac is the zero-retry release gate, and a reference record that held a retried test would be failed.
