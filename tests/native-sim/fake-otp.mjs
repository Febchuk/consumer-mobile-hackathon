import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fixtureProviderSettings } from "../qa-runtime/tls-provider.mjs";

export const fakeOtpPort = 43128;
export const fakeCode = "000000";

/**
 * The fake phone-code provider. It speaks the two Twilio Verify calls the product makes, over plain HTTP on loopback,
 * for the reserved fixture phones only. It is also the backend's outbound proxy, and as a proxy it refuses everything
 * that is not addressed to itself, so the backend has no other way out.
 *
 * macOS note: the Linux lanes keep the product's HTTPS URL and trust a throwaway certificate through SSL_CERT_FILE.
 * The Darwin backend verifies certificates with the system trust store instead, and adding a certificate authority
 * for verify.twilio.com to a person's Mac is not acceptable, so here the scratch copy of the provider module is
 * pointed at this server. The repository's source is never changed.
 */
export async function startFakeOtp({ phones }) {
  const origin = "http://127.0.0.1:" + fakeOtpPort;
  const stats = { starts: 0, checks: 0, invalidCodes: 0, refused: 0 };
  const pending = new Map();
  const sockets = new Set();
  const base = "/v2/Services/" + fixtureProviderSettings.TWILIO_VERIFY_SERVICE_SID + "/";
  const authorization = "Basic " + Buffer.from(fixtureProviderSettings.TWILIO_ACCOUNT_SID + ":" + fixtureProviderSettings.TWILIO_AUTH_TOKEN).toString("base64");
  const server = createServer(async (request, response) => {
    const refuse = () => { stats.refused++; response.writeHead(403).end(); };
    const target = request.url?.startsWith(origin + "/") ? request.url.slice(origin.length) : request.url;
    if (request.socket.remoteAddress !== "127.0.0.1" || request.method !== "POST" || !target?.startsWith(base) || request.headers.authorization !== authorization || request.headers["content-type"] !== "application/x-www-form-urlencoded") return refuse();
    let text = "";
    for await (const chunk of request) { text += chunk.toString(); if (text.length > 2048) return refuse(); }
    const input = new URLSearchParams(text);
    let item;
    if (target === base + "Verifications") {
      const phone = input.get("To");
      if (!phones.includes(phone) || input.get("Channel") !== "sms" || input.get("RiskCheck") !== "enable") return refuse();
      stats.starts++;
      item = { sid: "VE" + createHash("sha256").update(phone + ":" + stats.starts).digest("hex").slice(0, 32), to: phone, status: "pending" };
      pending.set(item.sid, item);
    } else if (target === base + "VerificationCheck") {
      stats.checks++;
      const prior = pending.get(input.get("VerificationSid"));
      if (!prior || input.get("Code") !== fakeCode) { stats.invalidCodes++; response.writeHead(404).end(); return; }
      item = { ...prior, status: "approved" };
    } else return refuse();
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ ...item, account_sid: fixtureProviderSettings.TWILIO_ACCOUNT_SID, service_sid: fixtureProviderSettings.TWILIO_VERIFY_SERVICE_SID, channel: "sms" }));
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.on("connect", (_request, socket) => { stats.refused++; socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(fakeOtpPort, "127.0.0.1", () => { server.removeListener("error", reject); accept(); });
  });
  return { origin, stats, async close() { for (const socket of sockets) socket.destroy(); await new Promise((accept) => server.close(accept)); pending.clear(); } };
}
