// Week 5: market stats from the command line.
//
//   npm run -s market -- Irvine
//   npm run -s market -- Irvine --months 6 --type Condominium --beds 2
//   npm run -s market -- 92618                         (a ZIP works too)
//   npm run -s market -- --compare "Irvine,Tustin,Lake Forest" --type Condominium
//   npm run -s market -- "how's the Tustin condo market lately?"   (plain English)
//   npm run -s market -- Irvine --json
import { getMarketReport, compareMarkets } from "./marketStats.ts";
import { formatMarketReport, formatComparison } from "./formatMarket.ts";
import { parseMarketQuery } from "./parseMarketQuery.ts";
import { closePool } from "../db/pool.ts";

function parseArgs(argv: string[]) {
  const words: string[] = [];
  const o: { months?: number; type?: string | null; beds?: number | null; compare?: string; json: boolean } = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--months") o.months = Number(argv[++i]);
    else if (a === "--type") o.type = argv[++i];
    else if (a === "--beds") o.beds = Number(argv[++i]);
    else if (a === "--compare") o.compare = argv[++i];
    else if (a === "--json") o.json = true;
    else words.push(a);
  }
  return { text: words.join(" ").trim(), o };
}

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

async function main() {
  const { text, o } = parseArgs(process.argv.slice(2));
  let cities: string[] = o.compare ? o.compare.split(",").map((c) => title(c.trim())).filter(Boolean) : [];
  let months = o.months, type = o.type ?? null, beds = o.beds ?? null;

  if (!cities.length && text) {
    // A plain city / ZIP, or an English question
    if (/^[a-z .'-]+$/i.test(text) && text.split(/\s+/).length <= 3) cities = [title(text)];
    else if (/^\d{5}$/.test(text)) cities = [text];
    else {
      const q = parseMarketQuery(text);
      cities = q.cities; months = months ?? q.months; type = type ?? q.type; beds = beds ?? q.beds;
    }
  }
  if (!cities.length) {
    console.error('Usage: npm run -s market -- "<city or ZIP>" [--months 12] [--type Condominium] [--beds 3] | --compare "A,B"');
    process.exit(1);
  }

  const opts = { months: months ?? 12, type, beds };
  if (cities.length > 1) {
    const reports = await compareMarkets(cities, opts);
    console.log(o.json ? JSON.stringify(reports, null, 2) : formatComparison(reports));
  } else {
    const r = await getMarketReport(cities[0], opts);
    console.log(o.json ? JSON.stringify(r, null, 2) : formatMarketReport(r));
  }
}

main()
  .catch((err) => {
    const msg = String(err?.message || err);
    if (/ECONNREFUSED|Access denied|ER_ACCESS|ER_BAD_DB/i.test(msg)) {
      console.error("Can't reach the MLS database. Check MySQL is running (sudo systemctl start mysql) and .env settings.");
    } else console.error("Market stats failed:", msg);
    process.exitCode = 1;
  })
  .finally(closePool);
