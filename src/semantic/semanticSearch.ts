// Week 6: hybrid search = SQL for hard filters + embeddings for the "feel" of the description.
//
//   "quiet cul-de-sac home in Irvine under 2M with a big backyard"
//    -> SQL:       city = Irvine, price <= 2M          (exact, from the Week 2 parser)
//    -> semantic:  "quiet cul-de-sac ... big backyard" ranked against L_Remarks embeddings
import { createHash } from "node:crypto";
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";
import { KNOWN_CITIES } from "../search/parsePropertyQuery.ts";
import type { EmbeddingProvider } from "./embeddings.ts";
import type { VectorStore } from "./vectorStore.ts";
import type { ListingRow, SearchResult } from "../db/listings.ts";
import { MAX_LIMIT } from "../db/queries.ts";

// ---------- what part of a message is "descriptive"? ----------

const STOP = new Set(`a an the and or but with without w for of in on at to from by near around within into
  i me my we our you your it its this that these those them they there here is are was were be been am
  do does did has have had having want wants wanted need needs looking look find show give get see tell
  some any all more less most least very really just only also please thanks thank hi hey ok okay like would could should can
  home homes house houses condo condos condominium townhome townhomes townhouse townhouses property properties place places
  listing listings unit units apartment apartments sfr single family detached duplex triplex land lot lots
  bed beds bedroom bedrooms bd br bath baths bathroom bathrooms ba sqft sq ft square feet foot
  under below over above between less than max min maximum minimum up budget price priced cost costs dollars
  million mil thousand k m hoa fee fees pool pools view views
  what about how which where who when one ones something anything else instead same now new
  sort order sorted rank top first last best high low highest lowest recent latest listed just
  cheapest cheaper newest biggest bigger largest priciest expensive affordable smaller fewer
  ca california area city cities neighborhood`.split(/\s+/).filter(Boolean));

const CITY_WORDS = new Set(KNOWN_CITIES.flatMap((c) => c.toLowerCase().split(" ")));

// "quiet cul-de-sac in Irvine with a big backyard under 2M" -> ["quiet", "cul-de-sac", "backyard"]
// ("big" is kept only when it describes something: "big backyard" -> "backyard" carries it.)
export function descriptiveTerms(text: string, city?: string | null): string[] {
  const cityWords = new Set([...(city ? city.toLowerCase().split(" ") : [])]);
  const words = text.toLowerCase()
    .replace(/\$?\d[\d,.]*\s*(k|m|mm|million|thousand)?\b/g, " ")   // numbers / prices
    .match(/[a-z][a-z'-]*[a-z]|[a-z]/g) ?? [];
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 3 || STOP.has(w) || cityWords.has(w) || CITY_WORDS.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

// Text we embed for each listing: a little structure + the agent's description
export function listingDocText(r: { type?: string | null; L_City?: string | null; beds?: number | null; baths?: number | null; sqft?: number | null; remarks?: string | null }): string {
  const type = r.type ? r.type.replace(/([a-z])([A-Z])/g, "$1 $2") : "Home";
  const facts = [
    `${type} in ${r.L_City ?? "California"}.`,
    r.beds != null ? `${r.beds} bed` : null,
    r.baths != null ? `${r.baths} bath` : null,
    r.sqft ? `${r.sqft} sqft.` : null,
  ].filter(Boolean).join(" ");
  const remarks = String(r.remarks ?? "").replace(/\s+/g, " ").trim().slice(0, 4000);
  return `${facts} ${remarks}`.trim();
}

export const textHash = (t: string) => createHash("sha1").update(t).digest("hex").slice(0, 16);

// The sentence of the description that best matches the request, for "why this matched"
export function bestSnippet(remarks: string | null, query: string, max = 160): string | null {
  const text = String(remarks ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const terms = descriptiveTerms(query).map((t) => t.replace(/(ing|ed|es|s)$/, ""));
  const sentences = text.split(/(?<=[.!?])\s+|\s*[;•]\s*/).filter((s) => s.length > 3);
  const scored = sentences.map((sent, i) => {
    const low = sent.toLowerCase();
    return { sent, i, score: terms.reduce((n, t) => n + (t && low.includes(t) ? 1 : 0), 0) };
  });
  const ranked = scored.slice().sort((a, b) => b.score - a.score || a.i - b.i);
  let best = ranked[0]?.sent ?? text;
  // if a second sentence also matches and both fit, show both (in their original order)
  const second = ranked[1];
  if (ranked[0] && second && second.score > 0 && best.length + second.sent.length + 1 <= max) {
    best = [ranked[0], second].sort((a, b) => a.i - b.i).map((x) => x.sent).join(" ");
  }
  return best.length > max ? best.slice(0, max - 3).trimEnd() + "..." : best;
}

// ---------- the search ----------

export interface SemanticMatch { score: number; snippet: string | null }
export interface SemanticResult extends SearchResult {
  matches: Record<string, SemanticMatch>;
  candidates: number;      // listings that passed the SQL filters
  indexed: number;         // ...and have an embedding
}

export interface SemanticDeps {
  provider: EmbeddingProvider;
  store: VectorStore;
  candidateIds: (f: Partial<PropertyFilters>) => Promise<string[]>;   // SQL hard filters
  fetchByIds: (ids: string[]) => Promise<(ListingRow & { remarks: string | null })[]>;
}

export const MAX_SEMANTIC_RESULTS = 50; // never rank past 50 (10 pages of 5)

export async function semanticSearch(
  text: string, filters: Partial<PropertyFilters>, opts: { page?: number; limit?: number },
  deps: SemanticDeps,
): Promise<SemanticResult> {
  if (deps.store.meta.model !== deps.provider.model || deps.store.meta.dims !== deps.provider.dims) {
    throw new Error(`The index was built with ${deps.store.meta.model} (${deps.store.meta.dims} dims) but the current provider is ${deps.provider.model} (${deps.provider.dims}). Re-run npm run embed:index -- --rebuild`);
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? 5)));
  const page = Math.max(1, Math.floor(opts.page ?? 1));

  // 1) hard filters in SQL (only when there are any; otherwise rank everything indexed)
  const hasFilters = Object.keys(filters).length > 0;
  const ids = hasFilters ? await deps.candidateIds(filters) : null;
  const only = ids ? new Set(ids) : undefined;
  const indexed = only ? deps.store.countIndexed(only) : deps.store.size;

  // 2) rank by meaning
  const qv = await deps.provider.embedQuery(text);
  const hits = deps.store.search(qv, Math.min(MAX_SEMANTIC_RESULTS, page * limit), only);
  const pageHits = hits.slice((page - 1) * limit, page * limit);

  // 3) fetch the rows for this page and keep the ranking order
  const rows = pageHits.length ? await deps.fetchByIds(pageHits.map((h) => h.id)) : [];
  const byId = new Map(rows.map((r) => [String(r.L_ListingID), r]));
  const listings = pageHits.map((h) => byId.get(h.id)).filter((r): r is NonNullable<typeof r> => Boolean(r));

  const matches: Record<string, SemanticMatch> = {};
  for (const h of pageHits) {
    const r = byId.get(h.id);
    matches[h.id] = { score: Math.round(h.score * 1000) / 1000, snippet: bestSnippet(r?.remarks ?? null, text) };
  }

  const total = Math.min(indexed, MAX_SEMANTIC_RESULTS);
  return {
    listings, total, page, limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    matches, candidates: ids ? ids.length : deps.store.size, indexed,
  };
}
