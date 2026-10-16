// Week 3 entry point: free text -> Week 2 parser -> MySQL -> property cards.
//
//   npm run search -- "3 bed condos in Irvine under 1.5M"
//   npm run search -- "3 bed condos in Irvine under 1.5M" --page 2
//   npm run search -- "homes in San Diego" --limit 3 --sort newest --comps
//   npm run search -- "..." --json        (raw JSON, for debugging)
import { parsePropertyQuery, activeFilters } from "./parsePropertyQuery.ts";
import { searchActiveListings, getCompsSummary } from "../db/listings.ts";
import { formatSearchResult, formatCompsSummary } from "../db/format.ts";
import { closePool } from "../db/pool.ts";
import type { SortKey } from "../db/queries.ts";

function parseArgs(argv: string[]) {
  const words: string[] = [];
  const opts = { page: 1, limit: 5, sort: "price_asc" as SortKey, comps: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--page") opts.page = Number(argv[++i]);
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--sort") opts.sort = argv[++i] as SortKey;
    else if (a === "--comps") opts.comps = true;
    else if (a === "--json") opts.json = true;
    else words.push(a);
  }
  return { text: words.join(" ").trim(), opts };
}

async function main() {
  const { text, opts } = parseArgs(process.argv.slice(2));
  if (!text) {
    console.error('Usage: npm run search -- "<what you are looking for>" [--page N] [--limit N] [--sort price_asc|price_desc|newest|sqft_desc] [--comps]');
    process.exit(1);
  }

  const filters = activeFilters(parsePropertyQuery(text));
  const result = await searchActiveListings(filters, opts);

  if (opts.json) {
    console.log(JSON.stringify({ query: text, filters, ...result }, null, 2));
    return;
  }

  let out = formatSearchResult(result, filters);
  if (opts.comps && filters.city) {
    const summary = await getCompsSummary(filters.city, { type: filters.type ?? null });
    out += "\n\n" + formatCompsSummary(filters.city, summary);
  }
  console.log(out);
}

main()
  .catch((err) => {
    const msg = String(err?.message || err);
    if (/ECONNREFUSED|Access denied|ER_ACCESS|ER_BAD_DB/i.test(msg)) {
      console.error("Can't reach the MLS database. Check MySQL is running (sudo systemctl start mysql) and .env settings.");
    } else {
      console.error("Search failed:", msg);
    }
    process.exitCode = 1;
  })
  .finally(closePool);
