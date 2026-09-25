import { backfillHistoricalFirstInnings, buildHistoricalWalkForward } from "../server/mlbHistoricalResearch";

function requireDate(value: string | undefined, name: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
  return value;
}

const from = requireDate(process.argv[2], "from");
const to = requireDate(process.argv[3], "to");

console.log(`[mlb-research] isolated backfill ${from} through ${to}`);
const backfill = await backfillHistoricalFirstInnings(from, to);
console.log("[mlb-research] backfill", backfill);
const replay = await buildHistoricalWalkForward(from, to);
console.log("[mlb-research] walk-forward", replay);
console.log("[mlb-research] complete");
process.exit(0);
