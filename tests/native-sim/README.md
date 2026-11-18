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
- Ctrl-C or a termination signal at any point still deletes the simulator, stops the backend and writes the evidence.
- The demo and the tests share fixed loopback ports (3210, 3211, 8198, 8199, 43128), so only one can run at a time.

## Known simulator limits

- Messages on a simulator has no account, so no message is ever sent; tests use its built-in synthetic conversation.
- Messages reports a new conversation identity after it is relaunched, so a group link does not survive quitting Messages. Tests that need "close and come back" reopen the screen instead, and the relaunch case stays blocked.

## Coverage bindings

`tests/coverage/native-bindings.json` binds native-layer (`.U`) assertions from `inventory.json` to `NATIVE-UI.<Class>.<test>`. These are proven only by a passing run of this command; they live outside `bindings.json` because that file is checked to hold backend (`.B`) evidence only, so the backend evidence report still shows them blocked.
