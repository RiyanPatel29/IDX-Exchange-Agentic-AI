// Week 6: WhatsApp text for description-based results.
import { formatListingCard, describeFilters } from "../db/format.ts";
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";
import type { SemanticResult } from "./semanticSearch.ts";
import { descriptiveTerms } from "./semanticSearch.ts";

export function formatSemanticResult(r: SemanticResult, f: Partial<PropertyFilters>, text: string): string {
  const what = descriptiveTerms(text, f.city).slice(0, 6).join(", ") || text;
  const where = Object.keys(f).length ? ` (${describeFilters(f)})` : "";
  if (!r.listings.length) {
    if (r.candidates > 0 && r.indexed === 0) {
      return `I found ${r.candidates.toLocaleString("en-US")} listings for ${describeFilters(f)}, but their descriptions aren't indexed yet, so I can't rank them by "${what}". Try without the description, or ask me again after the index is built.`;
    }
    return `No active listings match ${describeFilters(f)}. Try a higher budget, fewer beds, or a nearby city.`;
  }
  const start = (r.page - 1) * r.limit + 1;
  const end = start + r.listings.length - 1;
  const lines = [`Best matches for "${what}"${where}. Showing ${start}-${end}:`];
  r.listings.forEach((l, i) => {
    const m = r.matches[String(l.L_ListingID)];
    let card = formatListingCard(l, start + i);
    if (m?.snippet) card += `\n✨ "${m.snippet}"`;
    lines.push(card);
  });
  let out = lines.join("\n\n");
  if (r.page < r.totalPages) out += `\n\nReply "more" for the next best matches.`;
  if (r.indexed < r.candidates) {
    out += `\n\n_Ranked ${r.indexed.toLocaleString("en-US")} of ${r.candidates.toLocaleString("en-US")} matching listings (the rest aren't indexed yet)._`;
  }
  return out;
}
