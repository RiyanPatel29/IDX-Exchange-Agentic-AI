// Week 4: one entry point for a WhatsApp message.
// Loads the user's session, works out what they mean (new search, refine, more, details),
// runs it, saves the session, and returns the reply text.
// Week 5 adds market questions ("how's the Irvine condo market?", "compare Irvine vs Tustin").
// Week 6 adds description search ("quiet street with a big backyard") via embeddings.
// Week 7 adds recommendations ("best deals in Irvine", "homes like #2", "I like #3").
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
import { parseRecIntent, type RecIntent } from "../recommend/recIntent.ts";
import { recommend, type RecDeps } from "../recommend/recommend.ts";
import { formatRecPage, formatFavorites } from "../recommend/formatRec.ts";
import { parsePropertyQuery, activeFilters } from "../search/parsePropertyQuery.ts";
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
  // Week 7 (optional so older tests don't need it)
  rec?: RecDeps;
}

export interface Reply {
  intent: string;      // reset | search | refine | page | details | need_city | market | need_market_city
                       // | semantic | recommend | similar | like | dislike | favorites | none
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

  // Week 7: recommendations, "homes like #2", likes/dislikes
  if (deps.rec) {
    const ri = parseRecIntent(msg);
    if (ri) {
      const out = await runRecIntent(s, deps, msg, ri);
      if (out) return out;
    }
  }

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
      if (s.mode === "recommend" && deps.rec) {
        const out = await showRecPage(s, deps, action.page);
        remember(s, msg, "page");
        await deps.store.save(s);
        return { intent: "page", text: out };
      }
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
      s.lastDetailId = id;
      remember(s, msg, "details");
      await deps.store.save(s);
      return { intent: "details", text: formatListingDetails(l, action.index) };
    }

    case "search": {
      // Week 7: answer to "Which city should I find picks in?"
      if (s.mode === "recommend" && s.lastIntent === "need_city" && deps.rec && action.filters.city) {
        const out = await runRecommend(s, deps, { ...s.filters, ...action.filters });
        remember(s, msg, "recommend");
        await deps.store.save(s);
        return { intent: "recommend", text: out };
      }
      const sortChanged = action.sort !== s.sort || action.changes.some((c) => c.startsWith("sort"));
      s.sort = action.sort;
      const intent = action.refined ? "refine" : "search";

      // Week 6: descriptive words ("quiet", "backyard", "remodeled") switch on description search
      const desc = deps.semantic ? descriptiveTerms(msg, action.filters.city) : [];
      if (!action.refined) {
        s.recAnchor = null;
        s.mode = desc.length ? "semantic" : "structured";
        s.semanticText = desc.length ? msg : null;
      } else if (desc.length) {
        s.semanticText = s.mode === "semantic" && s.semanticText ? `${s.semanticText}; ${msg}` : msg;
        s.mode = "semantic";
      } else if (sortChanged) {
        s.mode = "structured"; // an explicit sort means plain filter order
        s.semanticText = null;
      } else if (s.mode === "recommend" && deps.rec && action.refined && action.filters.city) {
        // "only ones with a pool" / "cheaper" after picks -> new picks with the change
        s.recAnchor = null;
        let out = await runRecommend(s, deps, action.filters);
        if (action.changes.length) out = `🔄 Updated: ${action.changes.map(humanizeChange).join(", ")}\n\n${out}`;
        remember(s, msg, "recommend");
        await deps.store.save(s);
        return { intent: "recommend", text: out, changes: action.changes };
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

// ---------------- Week 7: recommendations ----------------

const MAX_LIKED = 30, MAX_DISLIKED = 50;

// Card number (or "this") -> listing id, using what's on screen
function resolveRef(s: SessionState, ref: number | "this"): string | null {
  if (ref === "this") return s.lastDetailId ?? (s.lastResultIds.length === 1 ? s.lastResultIds[0] : null);
  return s.lastResultIds[ref - s.lastResultStart] ?? null;
}

function onScreenRange(s: SessionState) {
  return s.lastResultIds.length
    ? `#${s.lastResultStart}-#${s.lastResultStart + s.lastResultIds.length - 1}`
    : null;
}

async function showRecPage(s: SessionState, deps: Deps, page: number, preloaded?: { rows: ListingRow[]; history?: any }) {
  const total = s.recRanked.length;
  const totalPages = Math.max(1, Math.ceil(total / s.limit));
  if (page > totalPages && total) {
    return `That's all ${total} of my picks. Say "I like #N" / "not #N" and "recommend" again to tune them, or try another city.`;
  }
  const slice = s.recRanked.slice((page - 1) * s.limit, page * s.limit);
  let rows = preloaded?.rows;
  if (!rows) {
    const fetched = await deps.rec!.byIds(slice.map((x) => x.id));
    const byId = new Map(fetched.map((r) => [String(r.L_ListingID), r]));
    rows = slice.map((x) => byId.get(x.id)).filter((r): r is ListingRow => Boolean(r));
  }
  const items = rows.map((r) => slice.find((x) => x.id === String(r.L_ListingID))!);
  s.mode = "recommend";
  s.page = page;
  s.totalPages = totalPages;
  s.lastResultIds = rows.map((r) => String(r.L_ListingID));
  s.lastResultStart = (page - 1) * s.limit + 1;
  if (rows.length) s.shown = shownStats(rows);
  return formatRecPage({
    rows, items, start: s.lastResultStart, total, poolSize: s.recPoolSize, filters: s.filters,
    anchorLabel: s.recAnchor?.label ?? null, liked: s.liked.length, history: preloaded?.history,
  });
}

async function runRecommend(s: SessionState, deps: Deps, filters: Partial<PropertyFilters>, anchorId?: string): Promise<string> {
  const r = await recommend({ filters, likedIds: s.liked, dislikedIds: s.disliked, anchorId }, deps.rec!);
  if (anchorId && !r.ranked.length) {
    // nothing similar: say so, but keep the current results on screen
    const label = r.anchor?.L_Address ?? "that home";
    return `I couldn't find active homes similar to ${label} right now (same city and type, price within 25%). Try "homes like" another one.`;
  }
  s.semanticText = null;
  s.recPoolSize = r.poolSize;
  s.recRanked = r.ranked.map((x) => ({ id: String(x.listing.L_ListingID), score: x.score, reasons: x.reasons.slice(0, 4) }));
  if (r.anchor) {
    s.recAnchor = { id: String(r.anchor.L_ListingID), label: r.anchor.L_Address ?? `MLS# ${r.anchor.L_DisplayId ?? r.anchor.L_ListingID}` };
    s.filters = Object.fromEntries(Object.entries({ city: r.anchor.L_City, type: r.anchor.type }).filter(([, v]) => v != null)) as Partial<PropertyFilters>;
  } else {
    s.recAnchor = null;
    s.filters = filters;
  }
  const firstRows = r.ranked.slice(0, s.limit).map((x) => x.listing);
  return showRecPage(s, deps, 1, { rows: firstRows, history: r.history });
}

async function runRecIntent(s: SessionState, deps: Deps, msg: string, ri: RecIntent): Promise<Reply | null> {
  switch (ri.kind) {
    case "clear_taste": {
      s.liked = []; s.disliked = [];
      remember(s, msg, "clear_taste");
      await deps.store.save(s);
      return { intent: "clear_taste", text: "Cleared your likes and dislikes. Your picks won't be tuned until you like some homes again." };
    }

    case "favorites": {
      const rows = s.liked.length ? await deps.rec!.byIds(s.liked) : [];
      const byId = new Map(rows.map((r) => [String(r.L_ListingID), r]));
      const ordered = s.liked.map((id) => byId.get(id)).filter((r): r is ListingRow => Boolean(r));
      if (ordered.length) {
        s.mode = "structured";
        s.lastResultIds = ordered.map((r) => String(r.L_ListingID));
        s.lastResultStart = 1;
        s.totalPages = 1;
      }
      remember(s, msg, "favorites");
      await deps.store.save(s);
      return { intent: "favorites", text: formatFavorites(ordered) };
    }

    case "like":
    case "dislike": {
      const ids: string[] = [], missing: string[] = [];
      for (const ref of ri.indexes) {
        const id = resolveRef(s, ref);
        if (id) ids.push(id); else missing.push(ref === "this" ? "that one" : `#${ref}`);
      }
      if (!ids.length) {
        // Not about a listing on screen (e.g. "not 3 beds"): let the normal flow handle it
        if (!s.lastResultIds.length) return null;
        const range = onScreenRange(s);
        return { intent: ri.kind, text: `I can only see ${range} right now. Which one did you mean?` };
      }
      if (ri.kind === "like") {
        s.disliked = s.disliked.filter((x) => !ids.includes(x));
        s.liked = [...ids, ...s.liked.filter((x) => !ids.includes(x))].slice(0, MAX_LIKED);
      } else {
        s.liked = s.liked.filter((x) => !ids.includes(x));
        s.disliked = [...ids, ...s.disliked.filter((x) => !ids.includes(x))].slice(0, MAX_DISLIKED);
        // hide it from the picks we're paging through
        s.recRanked = s.recRanked.filter((x) => !ids.includes(x.id));
      }
      remember(s, msg, ri.kind);
      await deps.store.save(s);
      const which = ri.indexes.filter((r) => r !== "this").map((r) => `#${r}`).join(", ") || "that one";
      const text = ri.kind === "like"
        ? `👍 Saved ${which}. You've liked ${s.liked.length} ${s.liked.length === 1 ? "home" : "homes"}. Say "recommend" for picks like ${ids.length > 1 ? "these" : "it"}, "homes like ${which.split(", ")[0]}", or "my favorites".`
        : `👎 Got it, I'll skip ${which} and steer away from homes like ${ids.length > 1 ? "those" : "it"}. Say "recommend" for fresh picks.`;
      return { intent: ri.kind, text: missing.length ? `${text}\n(I couldn't find ${missing.join(", ")} on screen.)` : text };
    }

    case "similar": {
      const id = resolveRef(s, ri.index);
      if (!id) {
        const range = onScreenRange(s);
        return { intent: "similar", text: range ? `Which one? I can see ${range}. Try "homes like #2".` : `Search first, then say "homes like #2". For example: "3 bed condos in Irvine".` };
      }
      const out = await runRecommend(s, deps, s.filters, id);
      remember(s, msg, "similar");
      await deps.store.save(s);
      return { intent: "similar", text: out };
    }

    case "recommend": {
      const parsed = activeFilters(parsePropertyQuery(msg));
      // "recommend something" with no city -> use what they were just searching
      const filters = parsed.city ? parsed : { ...s.filters, ...parsed };
      if (!filters.city) {
        s.filters = filters;
        s.mode = "recommend";
        s.recRanked = [];
        s.totalPages = 0;
        s.lastResultIds = [];
        remember(s, msg, "need_city");
        await deps.store.save(s);
        return { intent: "need_city", text: `Which city should I find picks in? (${describeFilters(filters)})` };
      }
      const out = await runRecommend(s, deps, filters);
      remember(s, msg, "recommend");
      await deps.store.save(s);
      return { intent: "recommend", text: out };
    }
  }
}

export { newSession };
