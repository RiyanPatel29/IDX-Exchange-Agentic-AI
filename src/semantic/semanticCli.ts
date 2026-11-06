// Week 6: try description search directly.
//
//   npm run -s semantic -- "quiet cul-de-sac in Irvine with a big backyard"
//   npm run -s semantic -- "modern condo with ocean views" --page 2
import { parsePropertyQuery, activeFilters } from "../search/parsePropertyQuery.ts";
import { liveSemantic } from "./semanticDeps.ts";
import { formatSemanticResult } from "./formatSemantic.ts";
import { closePool } from "../db/pool.ts";

async function main() {
  const args = process.argv.slice(2);
  let page = 1, json = false;
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--page") page = Number(args[++i]);
    else if (args[i] === "--json") json = true;
    else words.push(args[i]);
  }
  const text = words.join(" ").trim();
  if (!text) { console.error('Usage: npm run -s semantic -- "<description>" [--page N]'); process.exit(1); }
  const run = liveSemantic();
  if (!run) {
    console.error("No embedding index (or no API key). Build it first: npm run embed:index -- --city Irvine");
    process.exit(1);
  }
  const filters = activeFilters(parsePropertyQuery(text));
  const r = await run(text, filters, { page, limit: 5 });
  console.log(json ? JSON.stringify({ filters, ...r }, null, 2) : formatSemanticResult(r, filters, text));
}

main()
  .catch((err) => { console.error("Semantic search failed:", String(err?.message || err)); process.exitCode = 1; })
  .finally(closePool);
