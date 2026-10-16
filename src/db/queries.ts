// Week 3: SQL builders. Pure functions (no DB needed) so they're easy to test.
// They return { sql, params }: the SQL only ever contains ? placeholders,
// and every user-supplied value goes into params.
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";

export const MAX_LIMIT = 50; // handbook safety rule: never return more than 50 rows

export type SortKey = "price_asc" | "price_desc" | "newest" | "sqft_desc";

// Whitelist: users pick a key, never raw SQL
const SORTS: Record<SortKey, string> = {
  price_asc: "L_SystemPrice ASC",
  price_desc: "L_SystemPrice DESC",
  newest: "DaysOnMarket ASC",
  sqft_desc: "LM_Int2_3 DESC",
};

export interface SearchOptions {
  page?: number;
  limit?: number;
  sort?: SortKey;
  status?: string; // defaults to "Active"
}

export interface BuiltQuery {
  sql: string;
  params: (string | number)[];
  countSql: string;
  countParams: (string | number)[];
  page: number;
  limit: number;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const LISTING_COLUMNS = `
  L_ListingID, L_DisplayId, L_Address, L_City, L_Zip,
  L_SystemPrice AS price, L_Keyword2 AS beds, LM_Dec_3 AS baths,
  LM_Int2_3 AS sqft, L_Type_ AS type, L_Status AS status,
  LMD_MP_Latitude AS lat, LMD_MP_Longitude AS lng,
  YearBuilt, AssociationFee, DaysOnMarket,
  PoolPrivateYN, ViewYN, FireplaceYN, PhotoCount,
  LA1_UserFirstName, LA1_UserLastName, LO1_OrganizationName`;

export function buildListingQuery(f: Partial<PropertyFilters>, opts: SearchOptions = {}): BuiltQuery {
  const page = clampInt(opts.page, 1, 10_000, 1);
  const limit = clampInt(opts.limit, 1, MAX_LIMIT, 10);
  const offset = (page - 1) * limit;
  const status = opts.status || "Active";

  const where: string[] = ["(L_Status = ? OR StandardStatus = ?)"];
  const params: (string | number)[] = [status, status];

  if (f.city) { where.push("L_City = ?"); params.push(f.city); }
  if (f.minPrice != null) { where.push("L_SystemPrice >= ?"); params.push(f.minPrice); }
  if (f.maxPrice != null) { where.push("L_SystemPrice <= ?"); params.push(f.maxPrice); }
  if (f.beds != null) { where.push("L_Keyword2 >= ?"); params.push(f.beds); }
  if (f.baths != null) { where.push("LM_Dec_3 >= ?"); params.push(f.baths); }
  if (f.sqft != null) { where.push("LM_Int2_3 >= ?"); params.push(f.sqft); }
  if (f.type) { where.push("L_Type_ = ?"); params.push(f.type); }
  if (f.pool) { where.push("PoolPrivateYN = ?"); params.push(f.pool); }
  if (f.hasView) { where.push("ViewYN = ?"); params.push(f.hasView); }
  if (f.maxHoa != null) {
    // "no HOA" (0) should also match listings where the fee is blank
    where.push(f.maxHoa === 0 ? "(AssociationFee IS NULL OR AssociationFee = 0)" : "AssociationFee <= ?");
    if (f.maxHoa !== 0) params.push(f.maxHoa);
  }

  const whereSql = where.join("\n    AND ");
  const order = SORTS[opts.sort ?? "price_asc"] ?? SORTS.price_asc;

  // LIMIT/OFFSET are inlined after clampInt() guarantees they're safe integers.
  // (MySQL 8's prepared statements reject LIMIT ? with mysql2's execute.)
  const sql = `SELECT ${LISTING_COLUMNS}
  FROM rets_property
  WHERE ${whereSql}
  ORDER BY ${order}, L_ListingID
  LIMIT ${limit} OFFSET ${offset}`;

  const countSql = `SELECT COUNT(*) AS total FROM rets_property WHERE ${whereSql}`;

  return { sql, params, countSql, countParams: [...params], page, limit };
}

export interface CompsOptions {
  months?: number;   // look-back window, default 12
  beds?: number | null;
  type?: string | null; // PropertySubType, e.g. "Condominium"
  limit?: number;
}

// california_sold.CloseDate is a VARCHAR, so convert it with STR_TO_DATE.
// Also drop future dates (data has typos like 2072) and blank dates.
const CLOSE_DATE = "STR_TO_DATE(NULLIF(CloseDate, ''), '%Y-%m-%d')";

function compsWhere(city: string, opts: CompsOptions) {
  const months = clampInt(opts.months, 1, 120, 12);
  const where = [
    "City = ?",
    "PropertyType = 'Residential'",
    `${CLOSE_DATE} <= CURDATE()`,
    `${CLOSE_DATE} >= DATE_SUB(CURDATE(), INTERVAL ${months} MONTH)`,
    "ClosePrice > 0",
  ];
  const params: (string | number)[] = [city];
  if (opts.beds != null) { where.push("BedroomsTotal >= ?"); params.push(opts.beds); }
  if (opts.type) { where.push("PropertySubType = ?"); params.push(opts.type); }
  return { whereSql: where.join("\n    AND "), params, months };
}

export function buildCompsQuery(city: string, opts: CompsOptions = {}) {
  const limit = clampInt(opts.limit, 1, MAX_LIMIT, 10);
  const { whereSql, params, months } = compsWhere(city, opts);
  const sql = `SELECT ListingKey, UnparsedAddress, City, PostalCode,
    ${CLOSE_DATE} AS closeDate, ClosePrice, OriginalListPrice, ListPrice, DaysOnMarket,
    BedroomsTotal, BathroomsTotalInteger, LivingArea, PropertySubType, YearBuilt,
    ListAgentFullName, ListOfficeName, BuyerOfficeName
  FROM california_sold
  WHERE ${whereSql}
  ORDER BY closeDate DESC
  LIMIT ${limit}`;
  return { sql, params, months, limit };
}

export function buildCompsSummaryQuery(city: string, opts: CompsOptions = {}) {
  const { whereSql, params, months } = compsWhere(city, opts);
  const sql = `SELECT COUNT(*) AS soldCount,
    ROUND(AVG(ClosePrice)) AS avgClosePrice,
    ROUND(AVG(ClosePrice / NULLIF(LivingArea, 0))) AS avgPricePerSqft,
    ROUND(AVG(DaysOnMarket), 1) AS avgDom,
    ROUND(AVG(ClosePrice / NULLIF(ListPrice, 0)) * 100, 1) AS listToClosePct
  FROM california_sold
  WHERE ${whereSql}`;
  return { sql, params, months };
}
