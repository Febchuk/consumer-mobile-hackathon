import { ConvexReactClient } from "convex/react";

export const CONVEX_URL =
  process.env.EXPO_PUBLIC_CONVEX_URL ?? "https://reliable-kookabura-33.convex.cloud";
export const SITE_URL = CONVEX_URL.replace(".convex.cloud", ".convex.site");
export const convex = new ConvexReactClient(CONVEX_URL, { unsavedChangesWarning: false });
