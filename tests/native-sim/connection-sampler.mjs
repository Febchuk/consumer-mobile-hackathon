// Runs on a worker thread of the lane. ps and lsof take many seconds on a loaded runner, and starting a process holds the
// starting thread meanwhile. The lane's own thread serves the gateway and the control server, so sampling from it stopped
// every app call and every fixture call for that long.
import { parentPort, workerData } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";
import { nonLoopbackConnections } from "./simulator.mjs";

for (;;) {
  const started = performance.now();
  let rows = null;
  try { rows = nonLoopbackConnections(workerData.udid); } catch { /* a failed sample is a missed observation, not a result */ }
  parentPort.postMessage({ rows, ms: Math.round(performance.now() - started) });
  await delay(5000);
}
