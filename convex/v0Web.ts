function installUrl() {
  try {
    const url = new URL(process.env.V0_INSTALL_URL ?? "");
    const approvedPath = (url.hostname === "testflight.apple.com" && /^\/join\/[A-Za-z0-9]{8}$/.test(url.pathname))
      || (url.hostname === "apps.apple.com" && /\/id\d+\/?$/.test(url.pathname));
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash || !approvedPath) return null;
    return url.href;
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function appleAppSiteAssociation() {
  const prefix = process.env.V0_APPLE_APP_ID_PREFIX ?? "";
  const bundles = (process.env.V0_APPLE_BUNDLE_IDS ?? "").split(",");
  if (!/^[A-Z0-9]{10}$/.test(prefix) || prefix === "ABCDE12345") return null;
  if (bundles.length > 4 || new Set(bundles).size !== bundles.length) return null;
  if (!bundles.every((bundle) => bundle.length <= 155 && /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(bundle) && !/^com\.example(\.|$)/i.test(bundle))) return null;
  return JSON.stringify({ applinks: { details: [{ appIDs: bundles.map((bundle) => `${prefix}.${bundle}`), components: [{ "/": `/c/${"?".repeat(64)}` }] }] } });
}

export function landingResponse(request: Request) {
  const path = new URL(request.url).pathname;
  if (path === "/.well-known/apple-app-site-association") {
    const association = appleAppSiteAssociation();
    if (association) return new Response(association, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  if (path !== "/" && !/^\/c\/[a-f0-9]{64}$/.test(path)) return new Response("This legacy web page is no longer available.", { status: 410, headers: { "Cache-Control": "no-store" } });
  const install = installUrl();
  const control = install
    ? `<a href="${escapeHtml(install)}" rel="noreferrer">Get the app</a>`
    : "<button disabled>Get the app</button><p class=note>Installation access is waiting for a verified TestFlight invitation.</p>";
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Called It</title><style>body{margin:0;background:#f2f2f7;color:#1c1c1e;font-family:system-ui,-apple-system,sans-serif}main{max-width:420px;margin:12vh auto;padding:28px}h1{font-size:34px;letter-spacing:-1px}p{font-size:17px;line-height:1.5;color:#48484a}a,button{display:inline-block;background:#007aff;color:white;font:600 17px system-ui;text-decoration:none;border:0;border-radius:12px;padding:14px 22px;margin:12px 0}button:disabled{background:#d1d1d6;color:#48484a}.note{font-size:14px}</style><main><h1>Called It</h1><p>Private predictions with invited friends in Messages. Only invited members can open a bet or make a pick.</p><p>Called It does not read your chats, photos or contacts.</p><p>For now Called It works only on iPhone with iMessage. There is no Android app and no web version, and nothing can be viewed or picked from this page.</p>${control}<p class=note>After installing and signing in, return to Messages and tap the original card. This page does not sign you in or reveal the bet.</p></main></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
