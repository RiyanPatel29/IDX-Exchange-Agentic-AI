// Week 7: try recommendations from the command line.
//
//   npm run -s recommend -- "best deals in Irvine under 1.5M"
//   npm run -s recommend -- "3 bed condos in Tustin" --json
//   npm run -s recommend -- --like 1001 --like 1007 "condos in Irvine"
//   npm run -s recommend -- --similar 1001
import { parsePropertyQuery, activeFilters } from "../search/parsePropertyQuery.ts";
import { recommend, liveRecDeps } from "./recommend.ts";
import { formatRecPage } from "./formatRec.ts";
import { closePool } from "../db/pool.ts";

async function main() {
  const args = process.argv.slice(2);
  const words: string[] = [], liked: string[] = [], disliked: string[] = [];
  let similar: string | null = null, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--like") liked.push(args[++i]);
    else if (a === "--dislike") disliked.push(args[++i]);
    else if (a === "--similar") similar = args[++i];
    else if (a === "--json") json = true;
    else words.push(a);
  }
  const text = words.join(" ").trim();
  const filters = activeFilters(parsePropertyQuery(text));
  if (!similar && !filters.city) {
    console.error('Usage: npm run -s recommend -- "<request with a city>" [--like ID] [--dislike ID] | --similar ID');
    process.exit(1);
  }
  const r = await recommend({ filters, likedIds: liked, dislikedIds: disliked, anchorId: similar }, liveRecDeps());
  if (json) {
    console.log(JSON.stringify({
      filters: r.filters, poolSize: r.poolSize,
      picks: r.ranked.slice(0, 10).map((s) => ({ id: s.listing.L_ListingID, address: s.listing.L_Address, price: s.listing.price, score: s.score, parts: s.parts, reasons: s.reasons })),
    }, null, 2));
    return;
  }
  const top = r.ranked.slice(0, 5);
  console.log(formatRecPage({
    rows: top.map((s) => s.listing),
    items: top.map((s) => ({ id: String(s.listing.L_ListingID), score: s.score, reasons: s.reasons })),
    start: 1, total: r.ranked.length, poolSize: r.poolSize, filters: r.filters,
    anchorLabel: r.anchor?.L_Address ?? (similar ? `listing ${similar}` : null), liked: liked.length, history: r.history,
  }));
}

main()
  .catch((err) => {
    const msg = String(err?.message || err);
    if (/ECONNREFUSED|Access denied|ER_ACCESS|ER_BAD_DB/i.test(msg)) {
      console.error("Can't reach the MLS database. Check MySQL is running (sudo systemctl start mysql) and .env settings.");
    } else console.error("Recommendations failed:", msg);
    process.exitCode = 1;
  })
  .finally(closePool);
