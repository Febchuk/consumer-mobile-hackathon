import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { ConvexHttpClient } from "convex/browser";

const url = process.env.CONVEX_URL ?? "https://reliable-kookabura-33.convex.cloud";
const key = process.env.CONVEX_DEPLOY_KEY;
if (!key) throw new Error("CONVEX_DEPLOY_KEY missing");
const dir = process.argv[2] ?? "dist";
const client = new ConvexHttpClient(url);
client.setAdminAuth(key);

const types = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2",
  ".map": "application/json", ".txt": "text/plain",
};

async function walk(d) {
  const out = [];
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const deployId = String(Date.now());
const files = await walk(dir);
await Promise.all(files.map(async (f) => {
  const path = "/" + f.slice(dir.length).replace(/^\/+/, "");
  const contentType = types[extname(f)] ?? "application/octet-stream";
  const uploadUrl = await client.mutation("hosting:generateUploadUrl", {});
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": contentType }, body: await readFile(f) });
  const { storageId } = await res.json();
  await client.mutation("hosting:record", { path, storageId, contentType, deployId });
  console.log("uploaded", path);
}));
console.log("done", files.length, "files ->", url.replace(".convex.cloud", ".convex.site"));
