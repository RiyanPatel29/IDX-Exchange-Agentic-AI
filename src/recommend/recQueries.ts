// Week 7: SQL for recommendations. Uses both tables:
//   rets_property   -> the active homes we can recommend (candidate pool)
//   california_sold -> what similar homes actually sold for (value benchmark)
// and the handbook join key: CAST(r.L_ListingID AS UNSIGNED) = cs.ListingKey (sold history).
//
// Same rules as Week 3: only ? placeholders, user values in params.
// The candidate pool (max 200) is internal for scoring; users only ever see the top 5 per page.
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";
import { LISTING_COLUMNS, listingWhere, MAX_LIMIT } from "../db/queries.ts";
import { CLOSE_DATE } from "../market/marketQueries.ts";

export const MAX_POOL = 200;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Hard filters stay hard (city, type, min price). Soft wishes get some slack so a home
// that's 5% over budget or one bedroom short can still show up, just with a lower score.
// Pool / view become "nice to have" instead of filters.
export function relaxFilters(f: Partial<PropertyFilters>): Partial<PropertyFilters> {
  const r: Partial<PropertyFilters> = { ...f };
  if (r.maxPrice != null) r.maxPrice = Math.round(r.maxPrice * 1.1);
  if (r.beds != null && r.beds > 1) r.beds = r.beds - 1;
  if (r.sqft != null) r.sqft = Math.round(r.sqft * 0.9);
  if (r.maxHoa != null && r.maxHoa > 0) r.maxHoa = Math.round(r.maxHoa * 1.25);
  delete r.pool;
  delete r.hasView;
  return r;
}

// Candidate pool: active listings that roughly match. Newest first so the cap keeps fresh ones.
export function buildPoolQuery(f: Partial<PropertyFilters>, opts: { max?: number; excludeId?: string } = {}) {
  const { whereSql, params } = listingWhere(relaxFilters(f));
  const n = clampInt(opts.max, 1, MAX_POOL, MAX_POOL);
  let where = whereSql;
  if (opts.excludeId != null) { where += "\n    AND L_ListingID <> ?"; params.push(String(opts.excludeId)); }
  return {
    sql: `SELECT ${LISTING_COLUMNS}
  FROM rets_property
  WHERE ${where}
  ORDER BY DaysOnMarket ASC, L_ListingID
  LIMIT ${n}`,
    params,
  };
}

// "Homes like #2": same city and type, price within ±25%, beds within ±1.
export function similarFilters(anchor: {
  L_City: string | null; type: string | null; price: number | null; beds: number | null;
}): Partial<PropertyFilters> {
  const f: Partial<PropertyFilters> = {};
  if (anchor.L_City) f.city = anchor.L_City;
  if (anchor.type) f.type = anchor.type;
  if (anchor.price) {
    f.minPrice = Math.round(Number(anchor.price) * 0.75);
    f.maxPrice = Math.round((Number(anchor.price) * 1.25) / 1.1); // relaxFilters adds 10% back
  }
  if (anchor.beds != null && Number(anchor.beds) > 1) f.beds = Number(anchor.beds); // relax -> beds-1
  return f;
}

// Median $/sqft of recent sales of the same property type, at two levels:
//   zip_type (92618 condos), falling back to city_type (Irvine condos) when a ZIP has too few sales
// Aggregates only, one row per group (no individual sales leave the DB).
export function buildBenchmarksQuery(city: string, zips: string[], months = 12) {
  const m = clampInt(months, 1, 60, 12);
  const zipList = [...new Set(zips.filter((z) => /^\d{5}$/.test(String(z))))].slice(0, 50);
  const zipCond = zipList.length ? `PostalCode IN (${zipList.map(() => "?").join(", ")})` : "1 = 0";
  const params: (string | number)[] = [city, ...zipList];

  const level = (name: string, groupCols: string, keyZip: string, keyType: string, where: string) => `
  SELECT '${name}' AS level, ${keyZip} AS zip, ${keyType} AS subtype, COUNT(*) AS n,
    AVG(CASE WHEN rn IN (FLOOR((c + 1) / 2), CEIL((c + 1) / 2)) THEN ppsf END) AS medianPpsf
  FROM (
    SELECT PostalCode, City, PropertySubType, ppsf,
      ROW_NUMBER() OVER (PARTITION BY ${groupCols} ORDER BY ppsf) AS rn,
      COUNT(*) OVER (PARTITION BY ${groupCols}) AS c
    FROM s WHERE ${where}
  ) t
  GROUP BY ${groupCols}`;

  const sql = `WITH s AS (
    SELECT PostalCode, City, PropertySubType, ClosePrice / LivingArea AS ppsf
    FROM california_sold
    WHERE (City = ? OR ${zipCond})
      AND PropertyType = 'Residential'
      AND ${CLOSE_DATE} <= CURDATE()
      AND ${CLOSE_DATE} >= DATE_SUB(CURDATE(), INTERVAL ${m} MONTH)
      AND ClosePrice BETWEEN 10000 AND 100000000
      AND LivingArea BETWEEN 200 AND 50000
  )
  ${level("zip_type", "PostalCode, PropertySubType", "PostalCode", "PropertySubType", "PostalCode IS NOT NULL AND PostalCode <> ''")}
  UNION ALL
  ${level("city_type", "City, PropertySubType", "NULL", "PropertySubType", "City = ?")}`;
  params.push(city);
  return { sql, params, months: m };
}

// Past sales of the same property, via the handbook join key (L_ListingID -> ListingKey).
export function buildSoldHistoryQuery(listingIds: string[]) {
  const ids = listingIds.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_LIMIT);
  if (!ids.length) return null;
  return {
    sql: `SELECT ListingKey, ClosePrice, ${CLOSE_DATE} AS closeDate
  FROM california_sold
  WHERE ListingKey IN (${ids.map(() => "?").join(", ")})
    AND PropertyType = 'Residential'
    AND ${CLOSE_DATE} <= CURDATE()
    AND ClosePrice BETWEEN 10000 AND 100000000
  ORDER BY closeDate DESC
  LIMIT ${MAX_LIMIT}`,
    params: ids,
  };
}
