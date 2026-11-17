import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLoopbackTarget, nonLoopbackListeners } from "./loopback.mjs";

const header4 = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
const header6 = "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
const row4 = (local, state) => `   0: ${local} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000     0        0 1 1 0000000000000000 100 0 0 10 0`;
const row6 = (local, state) => `   0: ${local} 00000000000000000000000000000000:0000 ${state} 00000000:00000000 00:00000000 00000000     0        0 1 1 0000000000000000 100 0 0 10 0`;

test("accepts only loopback HTTP targets", () => {
  for (const target of ["http://127.0.0.1:3210", "http://127.9.8.7:3211/api/query", "http://[::1]:3210"]) assertLoopbackTarget(target);
  for (const target of [
    "http://localhost:3210",
    "http://0.0.0.0:3210",
    "http://10.0.0.5:3210",
    "http://192.168.1.2:3210",
    "http://127.0.0.1.example.com:3210",
    "http://1270.0.0.1:3210",
    "http://[::ffff:10.0.0.5]:3210",
    "http://example.convex.cloud",
    "https://127.0.0.1:3210",
    "http://user:pass@127.0.0.1:3210",
    "not a url",
  ]) assert.throws(() => assertLoopbackTarget(target), target);
});

test("reports listening sockets bound beyond loopback", () => {
  const loopbackOnly = [header4, row4("0100007F:0C8A", "0A"), row4("0100007F:0C8B", "0A")].join("\n");
  assert.deepEqual(nonLoopbackListeners(loopbackOnly, header6), []);
  assert.deepEqual(nonLoopbackListeners(header4, [header6, row6("00000000000000000000000001000000:0C8A", "0A"), row6("0000000000000000FFFF00000100007F:0C8A", "0A")].join("\n")), []);
  assert.deepEqual(nonLoopbackListeners([header4, row4("00000000:0C8A", "0A")].join("\n"), header6), ["00000000:0C8A"]);
  assert.deepEqual(nonLoopbackListeners([header4, row4("0500000A:0C8A", "0A")].join("\n"), header6), ["0500000A:0C8A"]);
  assert.deepEqual(nonLoopbackListeners(header4, [header6, row6("00000000000000000000000000000000:0C8A", "0A")].join("\n")), ["00000000000000000000000000000000:0C8A"]);
  assert.deepEqual(nonLoopbackListeners([header4, row4("00000000:0C8A", "01")].join("\n"), header6), []);
});
