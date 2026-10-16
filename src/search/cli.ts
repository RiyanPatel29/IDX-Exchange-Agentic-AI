// Usage: npx tsx src/search/cli.ts "3 bed condos in Irvine under $1.5M with a pool"
// Prints the structured filter object as JSON (used by the OpenClaw skill).
import { parsePropertyQuery, activeFilters } from "./parsePropertyQuery.ts";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('Usage: npx tsx src/search/cli.ts "<free-text property query>"');
  process.exit(1);
}
const filters = parsePropertyQuery(query);
console.log(JSON.stringify({ query, filters, active: activeFilters(filters) }, null, 2));
