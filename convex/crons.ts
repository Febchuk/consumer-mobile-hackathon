import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { runProviderCleanup } from "./v0ProviderCleanup";

const crons = cronJobs();
crons.interval("advance V0 cutoff and reveal clocks", { minutes: 1 }, internal.v0Jobs.sweep, {});
crons.interval("deliver neutral V0 notifications", { minutes: 1 }, internal.v0Notifications.deliverPending, {});
crons.interval("remove deleted accounts' phone verification records", { minutes: 5 }, runProviderCleanup, {});
export default crons;
