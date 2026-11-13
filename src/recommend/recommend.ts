// Week 7: the recommendation engine.
//   1. pull a candidate pool of active listings (relaxed filters, or "like #2")
//   2. pull $/sqft benchmarks from recent sales for those ZIPs
//   3. score every candidate (fit + value + freshness + taste) and rank
//   4. add sold history for the top picks (CAST(L_ListingID) = ListingKey)
//
// DB access is passed in (RecDeps) so tests run without MySQL.
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";
import type { ListingRow } from "../db/listings.ts";
import { query } from "../db/pool.ts";
import { getListingsByIds } from "../db/listings.ts";
import {
  buildPoolQuery, buildBenchmarksQuery, buildSoldHistoryQuery, similarFilters,
} from "./recQueries.ts";
import { scoreListing, rank, type Benchmark, type Scored } from "./score.ts";

export interface SoldHistory { ListingKey: number; ClosePrice: number; closeDate: string }

export interface RecDeps {
  pool: (f: Partial<PropertyFilters>, opts: { excludeId?: string }) => Promise<ListingRow[]>;
  benchmarks: (city: string, zips: string[]) => Promise<Benchmark[]>;
  soldHistory: (ids: string[]) => Promise<SoldHistory[]>;
  byIds: (ids: string[]) => Promise<ListingRow[]>;
}

export interface RecRequest {
  filters: Partial<PropertyFilters>;
  likedIds?: string[];
  dislikedIds?: string[];
  anchorId?: string | null;        // "homes like #2"
}

export interface RecResult {
  ranked: Scored[];                // up to 50, best first
  poolSize: number;
  anchor: ListingRow | null;
  filters: Partial<PropertyFilters>; // what the pool was built from
  history: Record<string, SoldHistory>;
}

export async function recommend(req: RecRequest, deps: RecDeps): Promise<RecResult> {
  const liked = req.likedIds ?? [], disliked = req.dislikedIds ?? [];
  const tasteIds = [...new Set([...liked, ...disliked, ...(req.anchorId ? [req.anchorId] : [])])].slice(0, 50);
  const tasteRows = tasteIds.length ? await deps.byIds(tasteIds) : [];
  const byId = new Map(tasteRows.map((r) => [String(r.L_ListingID), r]));

  const anchor = req.anchorId ? byId.get(String(req.anchorId)) ?? null : null;
  if (req.anchorId && !anchor) {
    return { ranked: [], poolSize: 0, anchor: null, filters: req.filters, history: {} };
  }
  const filters = anchor ? similarFilters(anchor) : req.filters;

  const pool = await deps.pool(filters, { excludeId: anchor ? String(anchor.L_ListingID) : undefined });
  const city = filters.city ?? pool[0]?.L_City ?? "";
  const zips = [...new Set(pool.map((l) => l.L_Zip).filter((z): z is string => Boolean(z)))];
  const benchmarks = pool.length && city ? await deps.benchmarks(city, zips) : [];

  const taste = {
    liked: liked.map((id) => byId.get(id)).filter((x): x is ListingRow => Boolean(x)),
    disliked: disliked.map((id) => byId.get(id)).filter((x): x is ListingRow => Boolean(x)),
  };
  const scored = pool.map((l) => scoreListing(l, { filters, benchmarks, taste, anchor }));
  const exclude = new Set([...disliked, ...(anchor ? [String(anchor.L_ListingID)] : [])]);
  const ranked = rank(scored, { excludeIds: exclude, max: 50 });

  // Sold history only for what we're about to show
  const top = ranked.slice(0, 5).map((s) => String(s.listing.L_ListingID));
  const hist = top.length ? await deps.soldHistory(top) : [];
  const history: Record<string, SoldHistory> = {};
  for (const h of hist) {
    const k = String(h.ListingKey);
    if (!history[k]) history[k] = h; // newest first from the query
  }
  return { ranked, poolSize: pool.length, anchor, filters, history };
}

// ---------- live MySQL deps ----------

const toDate = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));

export function liveRecDeps(): RecDeps {
  return {
    pool: async (f, opts) => {
      const q = buildPoolQuery(f, opts);
      return query<ListingRow>(q.sql, q.params);
    },
    benchmarks: async (city, zips) => {
      const q = buildBenchmarksQuery(city, zips);
      const rows = await query<any>(q.sql, q.params);
      return rows.map((r) => ({
        level: r.level, zip: r.zip == null ? null : String(r.zip), subtype: r.subtype ?? null,
        n: Number(r.n), medianPpsf: r.medianPpsf == null ? null : Number(r.medianPpsf),
      }));
    },
    soldHistory: async (ids) => {
      const q = buildSoldHistoryQuery(ids);
      if (!q) return [];
      const rows = await query<any>(q.sql, q.params);
      return rows.map((r) => ({ ListingKey: Number(r.ListingKey), ClosePrice: Number(r.ClosePrice), closeDate: toDate(r.closeDate) }));
    },
    byIds: (ids) => getListingsByIds(ids),
  };
}
