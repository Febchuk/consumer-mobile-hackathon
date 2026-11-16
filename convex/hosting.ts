import { internalMutation, internalQuery, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const generateUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const record = internalMutation({
  args: { path: v.string(), storageId: v.id("_storage"), contentType: v.string(), deployId: v.string() },
  handler: async (ctx, a) => {
    const old = await ctx.db
      .query("assets")
      .withIndex("by_path", (q) => q.eq("path", a.path))
      .collect();
    for (const o of old) {
      await ctx.storage.delete(o.storageId);
      await ctx.db.delete(o._id);
    }
    await ctx.db.insert("assets", a);
  },
});

export const lookup = internalQuery({
  args: { path: v.string() },
  handler: async (ctx, { path }) =>
    await ctx.db
      .query("assets")
      .withIndex("by_path", (q) => q.eq("path", path))
      .first(),
});

export const serve = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith("/")) path += "index.html";
  let asset = await ctx.runQuery(internal.hosting.lookup, { path });
  if (!asset && !path.includes(".", path.lastIndexOf("/"))) {
    asset =
      (await ctx.runQuery(internal.hosting.lookup, { path: path + ".html" })) ??
      (await ctx.runQuery(internal.hosting.lookup, { path: "/index.html" }));
  }
  if (!asset) return new Response("Not found", { status: 404 });
  const blob = await ctx.storage.get(asset.storageId);
  if (!blob) return new Response("Not found", { status: 404 });
  const immutable = path.startsWith("/_expo/") || path.startsWith("/assets/");
  return new Response(blob, {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
});
