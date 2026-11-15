import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.cron("prepare next drop", "55 * * * *", internal.admin.ensureNextRound, {});
export default crons;
