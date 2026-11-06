// Week 4: understand follow-up messages using the user's last search.
// Pure functions (no DB, no LLM) so every rule is unit tested.
//
//   "more" / "next"                 -> next page of the same search
//   "back"                          -> previous page
//   "tell me about #2"              -> details for card 2
//   "only ones with a pool"         -> same search + pool
//   "what about Tustin"             -> same search, new city
//   "cheaper" / "bigger"            -> tighten price / size from what was shown
//   "any price" / "pool doesn't matter" -> drop a filter
//   "sort by newest"                -> same search, new order
//   "start over"                    -> clear the session
//   "3 bed condos in Irvine"        -> a brand new search
import { parsePropertyQuery, activeFilters, type PropertyFilters } from "../search/parsePropertyQuery.ts";
import type { SortKey } from "../db/queries.ts";
import { hasSearch, type SessionState } from "./sessionStore.ts";

export type FollowUp =
  | { kind: "reset" }
  | { kind: "page"; page: number }
  | { kind: "details"; index: number }       // card number the user saw (1-based)
  | { kind: "search"; filters: Partial<PropertyFilters>; sort: SortKey; refined: boolean; changes: string[] }
  | { kind: "none" };                         // not a search message

const RESET = /^\s*(start\s+over|reset|restart|new\s+search|clear(\s+(it|search|filters|everything))?|forget\s+(it|that|everything))\b/i;
const MORE = /^\s*(more|next|next\s+page|show\s+more|more\s+(please|results|listings|homes|options|of\s+(those|them|these))|load\s+more|keep\s+going|see\s+more|any\s*more|what\s+else)\s*[.!?]*\s*$/i;
const BACK = /^\s*(back|previous|prev|go\s+back|previous\s+page|last\s+page)\s*[.!?]*\s*$/i;

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

// "#2", "number 2", "listing 2", "the 2nd one", "the second one", "tell me about 3"
export function parseDetailsIndex(text: string): number | null {
  const t = text.toLowerCase();
  let m = t.match(/#\s*(\d{1,3})\b/);
  if (m) return Number(m[1]);
  m = t.match(/\b(?:number|no\.?|listing|home|house|property|option|card|condo|unit)\s*#?\s*(\d{1,3})\b(?!\s*(?:k|m|bed|bd|br|ba|bath|sq))/);
  if (m) return Number(m[1]);
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+(?:one|listing|home|house|property|option)\b/);
  if (m) return Number(m[1]);
  m = t.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:one|listing|home|house|property|option)\b/);
  if (m) return ORDINALS[m[1]];
  // "tell me about 3", "details on 2", "more on 4"
  m = t.match(/\b(?:about|on|for)\s+(\d{1,2})\s*[.!?]*\s*$/);
  if (m && /\b(tell|details?|info|more|show|describe|see)\b/.test(t)) return Number(m[1]);
  return null;
}

const SORT_RULES: [RegExp, SortKey][] = [
  [/\b(cheapest|lowest\s+price|least\s+expensive|price\s+low|low\s+to\s+high)\b/i, "price_asc"],
  [/\b(most\s+expensive|priciest|highest\s+price|price\s+high|high\s+to\s+low|luxury\s+first)\b/i, "price_desc"],
  [/\b(newest|latest|most\s+recent|just\s+listed|new\s+listings?|fewest\s+days)\b/i, "newest"],
  [/\b(biggest|largest|most\s+space|most\s+sq(uare)?\s*f(ee)?t)\b/i, "sqft_desc"],
];

export function parseSort(text: string): SortKey | null {
  // only when they talk about ordering, so "the biggest pool" alone doesn't re-sort
  if (!/\b(sort|order|first|show\s+me\s+the|rank|top)\b/i.test(text)) return null;
  for (const [re, key] of SORT_RULES) if (re.test(text)) return key;
  return null;
}

// Messages that start like this change the current search instead of starting a new one
const REFINE_START = /^\s*(only|just|ok(ay)?|and|but|also|plus|what\s+about|how\s+about|same|now|actually|instead|make\s+it|change|switch|try|show\s+(me\s+)?only|filter|limit|any|with|without|no\b|w\/|cheaper|less\s+expensive|more\s+expensive|pricier|bigger|larger|smaller|fewer|more\s+(bed|bath)|at\s+least|under|below|over|above|max|min|i\s+(also\s+)?want|must\s+have|needs?\s+to|those|them|ones|sort|order)/i;

// Words that can follow "what about" but are not a city
const NOT_A_CITY = /\b(cheaper|bigger|larger|smaller|pricier|ones?|those|them|it|that|this|pool|view|hoa|condos?|houses?|homes?|townho(me|use)s?|bed|beds|bedrooms?|baths?|bathrooms?|sq|sqft|price|budget|newest|cheapest|more|less|fewer|the|any|with|without|one|options?)\b|\d/i;

function toTitle(s: string) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// "what about Yorba Linda?" / "try Tustin instead" / "how about in Lake Forest"
export function cityFromFollowUp(text: string): string | null {
  const m = text.match(/^\s*(?:what\s+about|how\s+about|try|and|ok(?:ay)?\s+(?:what|how)\s+about|switch\s+to|change\s+(?:it\s+)?to)\s+(?:in\s+|near\s+)?([a-z][a-z\s'.-]{1,40}?)\s*(?:instead)?\s*[?.!]*\s*$/i);
  if (!m) return null;
  const words = m[1].trim().split(/\s+/);
  if (words.length > 3 || NOT_A_CITY.test(m[1])) return null;
  return toTitle(m[1].trim());
}

export function bareCity(text: string): string | null {
  const t = text.trim().replace(/[?.!]+$/, "").replace(/^(in|near)\s+/i, "");
  if (!/^[a-z][a-z\s'.-]{1,40}$/i.test(t) || t.split(/\s+/).length > 3 || NOT_A_CITY.test(t)) return null;
  return toTitle(t);
}

function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
export { median };

const roundPrice = (n: number) => Math.round(n / 5_000) * 5_000;

// Apply "cheaper", "bigger", "any price", "pool doesn't matter"... Returns what changed.
function applyRelativeAndRemovals(
  text: string, f: Partial<PropertyFilters>, s: SessionState, parsed: Partial<PropertyFilters>,
): void {
  const t = text.toLowerCase();
  // label is just for readability at the call sites
  const drop = (key: keyof PropertyFilters, _label: string) => { delete f[key]; };
  const dontCare = (word: string) =>
    new RegExp(String.raw`\b(any|remove|drop|forget|ignore|no\s+preference\s+on|don'?t\s+care\s+about|doesn'?t\s+matter)\b[^.,;]*\b${word}|\b${word}[^.,;]*\b(doesn'?t\s+matter|is\s+fine|either\s+way|optional|not\s+needed)\b`, "i").test(t);

  if (/\b(any|no)\s+(price|budget|max(imum)?\s+price)\b|\b(price|budget)\b[^.,;]*\b(doesn'?t\s+matter|is\s+flexible)\b|\bremove\s+(the\s+)?(price|budget)\b/i.test(t)) {
    drop("maxPrice", "max price"); drop("minPrice", "min price");
  }
  if (dontCare("pool")) drop("pool", "pool filter");
  if (dontCare("views?")) drop("hasView", "view filter");
  if (dontCare("hoa")) drop("maxHoa", "HOA filter");
  if (dontCare("(type|kind|property\\s+type)")) drop("type", "property type");
  if (dontCare("(beds?|bedrooms?)")) drop("beds", "bedroom minimum");
  if (dontCare("(baths?|bathrooms?)")) drop("baths", "bathroom minimum");
  if (dontCare("(size|sq\\s*ft|sqft|square\\s+feet)")) drop("sqft", "size minimum");
  if (/\b(anywhere|any\s+city|all\s+cities|any\s+area)\b/i.test(t)) drop("city", "city");

  // cheaper: 15% under the current max (or under the most expensive one shown)
  if (/\b(cheaper|less\s+expensive|lower\s+(the\s+)?(price|budget)|more\s+affordable|budget\s+friendly)\b/i.test(t) && parsed.maxPrice == null) {
    const base = s.filters.maxPrice ?? s.shown.maxPrice;
    if (base) { f.maxPrice = roundPrice(base * 0.85); }
  }
  // pricier: raise the max 25%, or start above the cheapest shown
  if (/\b(more\s+expensive|pricier|higher\s+(price|budget)|raise\s+(the\s+)?(price|budget)|nicer|upscale)\b/i.test(t) && parsed.minPrice == null && parsed.maxPrice == null) {
    if (s.filters.maxPrice) { f.maxPrice = roundPrice(s.filters.maxPrice * 1.25); }
    else if (s.shown.maxPrice) { f.minPrice = roundPrice(s.shown.maxPrice); }
  }
  // bigger: 20% more space than now (or than the typical home shown)
  if (/\b(bigger|larger|more\s+(space|room|square\s+feet|sq\s*ft))\b/i.test(t) && !/\bbigger\s+(yard|lot|pool|garage|kitchen)\b/i.test(t) && parsed.sqft == null) {
    const base = s.filters.sqft ?? s.shown.medianSqft;
    if (base) { f.sqft = Math.round((base * 1.2) / 50) * 50; }
  }
  if (/\b(smaller|less\s+space)\b/i.test(t) && parsed.sqft == null) {
    drop("sqft", "size minimum");
  }
  // more / fewer bedrooms without a number
  if (/\b(more|extra|another|additional)\s+(bed|bedroom)s?\b/i.test(t) && !/\d\s*(bed|bd|br)/i.test(t)) {
    f.beds = (s.filters.beds ?? 2) + 1;
  }
  if (/\b(fewer|less)\s+(bed|bedroom)s?\b/i.test(t) && !/\d\s*(bed|bd|br)/i.test(t) && s.filters.beds) {
    f.beds = Math.max(0, s.filters.beds - 1);
  }
}

function describeNew(fresh: Partial<PropertyFilters>): string[] {
  return Object.entries(fresh).map(([k, v]) => `${k} → ${v}`);
}

// What changed between two filter sets, e.g. ["pool → True", "removed maxPrice"]
export function diffFilters(before: Partial<PropertyFilters>, after: Partial<PropertyFilters>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof PropertyFilters>;
  const out: string[] = [];
  for (const k of keys) {
    const a = before[k], b = after[k];
    if (a === b) continue;
    out.push(b == null ? `removed ${k}` : `${k} → ${b}`);
  }
  return out;
}

export function interpretFollowUp(text: string, s: SessionState): FollowUp {
  const prior = hasSearch(s);

  if (RESET.test(text)) return { kind: "reset" };

  if (prior) {
    if (MORE.test(text)) return { kind: "page", page: s.page + 1 };
    if (BACK.test(text)) return { kind: "page", page: Math.max(1, s.page - 1) };
    const idx = parseDetailsIndex(text);
    if (idx != null && s.lastResultIds.length) return { kind: "details", index: idx };
  }

  const parsed = activeFilters(parsePropertyQuery(text));
  const sort = parseSort(text);
  const looksRefine = REFINE_START.test(text);
  // After "Which city?", a bare reply like "Yorba Linda" is the city
  const followCity = prior
    ? cityFromFollowUp(text) ?? (s.lastIntent === "need_city" && !parsed.city ? bareCity(text) : null)
    : null;
  const isFullQuery = parsed.city != null && (parsed.type != null || parsed.beds != null || parsed.maxPrice != null || parsed.minPrice != null);

  // A complete new request ("2 bed condos in San Diego under 900k") starts fresh,
  // unless it clearly starts like a tweak ("what about 2 bed condos in San Diego").
  if (!prior || (isFullQuery && !looksRefine)) {
    if (Object.keys(parsed).length === 0 && !sort) return { kind: "none" };
    return { kind: "search", filters: parsed, sort: sort ?? "price_asc", refined: false, changes: describeNew(parsed) };
  }

  // Refine: start from the old filters, overwrite with anything new, then apply "cheaper", "any price"...
  const filters: Partial<PropertyFilters> = { ...s.filters, ...parsed };
  if (followCity && !parsed.city) filters.city = followCity;
  applyRelativeAndRemovals(text, filters, s, parsed);
  const changes = diffFilters(s.filters, filters);
  if (sort && sort !== s.sort) changes.push(`sort → ${sort}`);

  if (!changes.length) {
    // Nothing we understood as a search change. Let the agent answer normally.
    return { kind: "none" };
  }
  return { kind: "search", filters, sort: sort ?? s.sort, refined: true, changes };
}
