/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as admin from "../admin.js";
import type * as ai from "../ai.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as ext from "../ext.js";
import type * as game from "../game.js";
import type * as groups from "../groups.js";
import type * as hosting from "../hosting.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as market from "../market.js";
import type * as merge from "../merge.js";
import type * as reveal from "../reveal.js";
import type * as users from "../users.js";
import type * as v0Contract from "../v0Contract.js";
import type * as v0Runtime from "../v0Runtime.js";
import type * as v0Schema from "../v0Schema.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  ai: typeof ai;
  chat: typeof chat;
  crons: typeof crons;
  ext: typeof ext;
  game: typeof game;
  groups: typeof groups;
  hosting: typeof hosting;
  http: typeof http;
  lib: typeof lib;
  market: typeof market;
  merge: typeof merge;
  reveal: typeof reveal;
  users: typeof users;
  v0Contract: typeof v0Contract;
  v0Runtime: typeof v0Runtime;
  v0Schema: typeof v0Schema;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
