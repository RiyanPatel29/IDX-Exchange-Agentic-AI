// Week 4: one entry point for a WhatsApp message.
// Loads the user's session, works out what they mean (new search, refine, more, details),
// runs it, saves the session, and returns the reply text.
// Week 5 adds market questions ("how's the Irvine condo market?", "compare Irvine vs Tustin").
// Week 6 adds description search ("quiet street with a big backyard") via embeddings.
//
// Database calls are passed in (deps) so tests can run without MySQL.
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";
import type { SearchOptions } from "../db/queries.ts";
import type { SearchResult, ListingDetail, ListingRow, SoldRow } from "../db/listings.ts";
import type { CompsOptions } from "../db/queries.ts";
import { formatSearchResult, formatListingDetails, describeFilters, formatCompCard, prettyType } from "../db/format.ts";
import type { MarketReport } from "../market/marketStats.ts";
import type { MarketOptions } from "../market/marketQueries.ts";
import { formatMarketReport, formatComparison } from "../market/formatMarket.ts";
import { planMarket } from "./marketIntent.ts";
import { descriptiveTerms, type SemanticResult } from "../semantic/semanticSearch.ts";
import { formatSemanticResult } from "../semantic/formatSemantic.ts";
import { hasSearch } from "../session/sessionStore.ts";
import { interpretFollowUp, median } from "../session/followUp.ts";
import { newSession, type SessionState, type SessionStore } from "../session/sessionStore.ts";

export interface Deps {
  store: SessionStore;
  search: (f: Partial<PropertyFilters>, opts: SearchOptions) => Promise<SearchResult>;
  getListing: (id: string) => Promise<ListingDetail | null>;
  // Week 5 (optional so older tests don't need them)
  market?: (place: string, opts: MarketOptions) => Promise<MarketReport>;
  recentSales?: (city: string, opts: CompsOptions) => Promise<SoldRow[]>;
  // Week 6 (optional: only set when an embedding index exists)
  semantic?: (text: string, f: Partial<PropertyFilters>, opts: { page: number; limit: number }) => Promise<SemanticResult>;
}

export interface Reply {
  intent: string;      // reset | search | refine | page | details | need_city | market | need_market_city | none
  text: string | null; // null = not a property message, the agent should answer itself
  changes?: string[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const LABELS: Record<string, string> = {
  city: "city", minPrice: "min price", maxPrice: "max price", beds: "beds", baths: "baths",
  sqft: "min sqft", type: "type", pool: "pool", hasView: "view", maxHoa: "max HOA", sort: "sort",
};

// "maxPrice → 900000" -> "max price $900,000"
export function humanizeChange(c: string): string {
  const removed = c.match(/^removed (\w+)$/);
  if (removed) return `no ${LABELS[removed[1]] ?? removed[1]} filter`;
  const m = c.match(/^(\w+) → (.*)$/);
  if (!m) return c;
  const [, key, val] = m;
  if (/price|Hoa/i.test(key) && /^\d+$/.test(val)) return `${LABELS[key]} ${money(Number(val))}`;
  if (key === "pool" || key === "hasView") return val === "True" ? `with ${LABELS[key]}` : `no ${LABELS[key]}`;
  if (key === "type") return val.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (key === "beds" || key === "baths") return `${val}+ ${LABELS[key]}`;
  if (key === "sort") {
    const names: Record<string, string> = { price_asc: "lowest price", price_desc: "highest price", newest: "newest", sqft_desc: "biggest" };
    return `sorted by ${names[val] ?? val}`;
  }
  return `${LABELS[key] ?? key} ${val}`;
}

function shownStats(rows: ListingRow[]) {
  const prices = rows.map((r) => Number(r.price)).filter((n) => n > 0);
  return {
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    medianSqft: median(rows.map((r) => Number(r.sqft))),
  };
}

function remember(s: SessionState, text: string, intent: string) {
  s.lastIntent = intent;
  s.history.push({ at: new Date().toISOString(), text: text.slice(0, 200), intent });
}

// Runs whichever kind of search the session is in (set s.mode / s.semanticText first)
async function runSearch(
  s: SessionState, deps: Deps, filters: Partial<PropertyFilters>, page: number,
): Promise<string> {
  if (s.mode === "semantic" && s.semanticText && deps.semantic) {
    const r = await deps.semantic(s.semanticText, filters, { page, limit: s.limit });
    s.filters = filters;
    s.page = r.page;
    s.totalPages = r.listings.length ? r.totalPages : 0;
    s.lastResultIds = r.listings.map((l) => String(l.L_ListingID));
    s.lastResultStart = (r.page - 1) * r.limit + 1;
    if (r.listings.length) s.shown = shownStats(r.listings);
    return formatSemanticResult(r, filters, s.semanticText);
  }
  const r = await deps.search(filters, { page, limit: s.limit, sort: s.sort });
  s.mode = "structured";
  s.semanticText = null;
  s.filters = filters;
  s.page = r.page;
  s.totalPages = r.total ? r.totalPages : 0;
  s.lastResultIds = r.listings.map((l) => String(l.L_ListingID));
  s.lastResultStart = (r.page - 1) * r.limit + 1;
  if (r.listings.length) s.shown = shownStats(r.listings);
  return formatSearchResult(r, filters);
}

export async function handleMessage(userId: string, text: string, deps: Deps): Promise<Reply> {
  const s = await deps.store.get(userId);
  const msg = String(text || "").trim();

  // Week 5: market questions and market follow-ups go first
  if (deps.market) {
    const plan = planMarket(msg, s);
    if (plan) return runMarket(s, deps, msg, plan);
  }

  const action = interpretFollowUp(msg, s);

  switch (action.kind) {
    case "reset": {
      await deps.store.clear(userId);
      return { intent: "reset", text: "Cleared your search. What are you looking for? (e.g. \"3 bed condos in Irvine under 1.5M\")" };
    }

    case "page": {
      if (!s.filters.city && s.mode !== "semantic") return { intent: "need_city", text: "Which city should I search?" };
      if (s.totalPages && action.page > s.totalPages) {
        return { intent: "page", text: `That's everything for ${describeFilters(s.filters)} (${s.totalPages} ${s.totalPages === 1 ? "page" : "pages"}). Try "cheaper", "any price" or another city.` };
      }
      const out = await runSearch(s, deps, s.filters, action.page);
      remember(s, msg, "page");
      await deps.store.save(s);
      return { intent: "page", text: out };
    }

    case "details": {
      const pos = action.index - s.lastResultStart;
      const id = s.lastResultIds[pos];
      if (id == null) {
        const end = s.lastResultStart + s.lastResultIds.length - 1;
        return { intent: "details", text: `I only have #${s.lastResultStart}-#${end} on screen right now. Which one?` };
      }
      const l = await deps.getListing(id);
      if (!l) return { intent: "details", text: `Listing #${action.index} isn't available anymore (it may have sold or been pulled).` };
      remember(s, msg, "details");
      await deps.store.save(s);
      return { intent: "details", text: formatListingDetails(l, action.index) };
    }

    case "search": {
      const sortChanged = action.sort !== s.sort || action.changes.some((c) => c.startsWith("sort"));
      s.sort = action.sort;
      const intent = action.refined ? "refine" : "search";

      // Week 6: descriptive words ("quiet", "backyard", "remodeled") switch on description search
      const desc = deps.semantic ? descriptiveTerms(msg, action.filters.city) : [];
      if (!action.refined) {
        s.mode = desc.length ? "semantic" : "structured";
        s.semanticText = desc.length ? msg : null;
      } else if (desc.length) {
        s.semanticText = s.mode === "semantic" && s.semanticText ? `${s.semanticText}; ${msg}` : msg;
        s.mode = "semantic";
      } else if (sortChanged) {
        s.mode = "structured"; // an explicit sort means plain filter order
        s.semanticText = null;
      }

      if (!action.filters.city && s.mode !== "semantic") {
        // Park the filters and ask. The next message ("Irvine") fills in the city.
        s.filters = action.filters;
        s.totalPages = 0;
        s.lastResultIds = [];
        remember(s, msg, "need_city");
        await deps.store.save(s);
        return { intent: "need_city", text: `Which city should I search? (${describeFilters(action.filters)})` };
      }
      let out = await runSearch(s, deps, action.filters, 1);
      if (action.refined && action.changes.length) {
        out = `🔄 Updated: ${action.changes.map(humanizeChange).join(", ")}\n\n${out}`;
      }
      remember(s, msg, intent);
      await deps.store.save(s);
      return { intent, text: out, changes: action.changes };
    }

    default: {
      // Week 6: "only ones with a big backyard" / "something quiet near a park" add to the description search
      const desc = deps.semantic ? descriptiveTerms(msg, s.filters.city) : [];
      const homeTalk = /\b(with|has|have|having|ones?|homes?|houses?|condos?|places?|something|anything|listings?|near|walk(ing|able)?|close\s+to|quiet|yard|backyard|kitchen|garage|remodeled|renovated|updated|modern|style)\b/i;
      if (desc.length && homeTalk.test(msg) && (hasSearch(s) || /\b(home|house|condo|place|listing)s?\b/i.test(msg))) {
        s.semanticText = s.mode === "semantic" && s.semanticText ? `${s.semanticText}; ${msg}` : msg;
        s.mode = "semantic";
        const out = await runSearch(s, deps, s.filters, 1);
        remember(s, msg, "semantic");
        await deps.store.save(s);
        return { intent: "semantic", text: out };
      }
      return { intent: "none", text: null };
    }
  }
}

async function runMarket(
  s: SessionState, deps: Deps, msg: string, plan: NonNullable<ReturnType<typeof planMarket>>,
): Promise<Reply> {
  const opts: MarketOptions = { months: plan.months, type: plan.type, beds: plan.beds };
  if (plan.kind === "need_market_city") {
    s.lastMarket = { cities: [], months: plan.months, type: plan.type, beds: plan.beds };
    remember(s, msg, "need_market_city");
    await deps.store.save(s);
    const what = plan.type ? `${prettyType(plan.type).toLowerCase()} ` : "";
    return { intent: "need_market_city", text: `Which city's ${what}market should I look at?` };
  }

  let text: string;
  if (plan.cities.length >= 2) {
    const reports: MarketReport[] = [];
    for (const c of plan.cities) reports.push(await deps.market!(c, opts));
    text = formatComparison(reports);
  } else {
    const report = await deps.market!(plan.cities[0], opts);
    text = formatMarketReport(report);
    if (plan.wantsRecentSales && deps.recentSales && report.summary.soldCount) {
      const comps = await deps.recentSales(plan.cities[0], { months: plan.months, type: plan.type, beds: plan.beds, limit: 3 });
      if (comps.length) text += "\n\n*Most recent sales*\n" + comps.map(formatCompCard).join("\n\n");
    }
  }

  s.lastMarket = { cities: plan.cities, months: plan.months, type: plan.type, beds: plan.beds };
  remember(s, msg, "market");
  await deps.store.save(s);
  return { intent: "market", text };
}

export { newSession };
