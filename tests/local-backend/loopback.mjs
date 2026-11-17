import assert from "node:assert/strict";

const loopbackV4 = /^127\.(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)$/;

export function assertLoopbackTarget(value) {
  const target = new URL(value);
  assert.equal(target.protocol, "http:", `Refusing non-local target protocol ${target.protocol}`);
  assert.equal(target.username + target.password, "", "Refusing a target that carries credentials");
  assert.ok(loopbackV4.test(target.hostname) || target.hostname === "[::1]", `Refusing non-loopback target ${target.hostname}`);
  return target;
}

export function nonLoopbackListeners(tcp4, tcp6) {
  const rows = (text) => text.trim().split("\n").slice(1).map((line) => line.trim().split(/\s+/)).filter((fields) => fields[3] === "0A").map((fields) => fields[1]);
  const v4 = rows(tcp4).filter((local) => !/^[0-9A-F]{6}7F:/i.test(local));
  const v6 = rows(tcp6).filter((local) => !/^(0{24}01000000|0{16}FFFF0000[0-9A-F]{6}7F):/i.test(local));
  return [...v4, ...v6];
}
