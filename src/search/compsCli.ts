// Week 3: recent sold comps from california_sold.
//
//   npm run comps -- Irvine
//   npm run comps -- "San Diego" --months 6 --beds 3 --type Condominium --limit 5
import { getSoldComps, getCompsSummary } from "../db/listings.ts";
import { formatCompCard, formatCompsSummary } from "../db/format.ts";
import { closePool } from "../db/pool.ts";

function parseArgs(argv: string[]) {
  const words: string[] = [];
  const o: { months: number; beds: number | null; type: string | null; limit: number } =
    { months: 12, beds: null, type: null, limit: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--months") o.months = Number(argv[++i]);
    else if (a === "--beds") o.beds = Number(argv[++i]);
    else if (a === "--type") o.type = argv[++i];
    else if (a === "--limit") o.limit = Number(argv[++i]);
    else words.push(a);
  }
  // "san diego" -> "San Diego"
  const city = words.join(" ").trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return { city, o };
}

async function main() {
  const { city, o } = parseArgs(process.argv.slice(2));
  if (!city) {
    console.error('Usage: npm run comps -- "<city>" [--months 12] [--beds 3] [--type Condominium] [--limit 5]');
    process.exit(1);
  }
  const [summary, comps] = await Promise.all([getCompsSummary(city, o), getSoldComps(city, o)]);
  const out = [formatCompsSummary(city, summary)];
  if (comps.length) out.push("Recent sales:", ...comps.map(formatCompCard));
  console.log(out.join("\n\n"));
}

main()
  .catch((err) => {
    console.error("Comps lookup failed:", String(err?.message || err));
    process.exitCode = 1;
  })
  .finally(closePool);
