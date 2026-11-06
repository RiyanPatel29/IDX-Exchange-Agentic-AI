// Week 5: SQL for market stats on california_sold (closed sales) + rets_property (active inventory).
// Pure builders returning { sql, params } with ? placeholders only, like Week 3.
//
// Medians use window functions (ROW_NUMBER / COUNT OVER), which work on MySQL 8+ and MariaDB 10.2+.
// MySQL has no MEDIAN(), and averages get pulled around by a few $20M sales.

export interface MarketOptions {
  months?: number;        // look-back window, default 12
  type?: string | null;   // PropertySubType / L_Type_, e.g. "Condominium"
  beds?: number | null;   // minimum bedrooms
}

// california_sold.CloseDate is a VARCHAR ("2026-05-14"), so convert it.
export const CLOSE_DATE = "STR_TO_DATE(NULLIF(CloseDate, ''), '%Y-%m-%d')";

// Sanity limits so typos ($1 sales, 3-sqft condos) don't skew the numbers
const PRICE_MIN = 10_000;
const PRICE_MAX = 100_000_000;
const SQFT_MIN = 200;
const SQFT_MAX = 50_000;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const isZip = (place: string) => /^\d{5}$/.test(place.trim());

// WHERE clause for sold homes in a city (or ZIP) over the last N months
export function soldWhere(place: string, opts: MarketOptions = {}) {
  const months = clampInt(opts.months, 1, 120, 12);
  const where = [
    isZip(place) ? "PostalCode = ?" : "City = ?",
    "PropertyType = 'Residential'",                     // skips leases (ResidentialLease) and land
    `${CLOSE_DATE} <= CURDATE()`,                        // skips typo dates like 2072
    `${CLOSE_DATE} >= DATE_SUB(CURDATE(), INTERVAL ${months} MONTH)`,
    `ClosePrice BETWEEN ${PRICE_MIN} AND ${PRICE_MAX}`,
  ];
  const params: (string | number)[] = [place.trim()];
  if (opts.type) { where.push("PropertySubType = ?"); params.push(opts.type); }
  if (opts.beds != null) { where.push("BedroomsTotal >= ?"); params.push(Number(opts.beds)); }
  return { whereSql: where.join("\n      AND "), params, months };
}

// price per sqft only when the living area looks real
const PPSF = `CASE WHEN LivingArea BETWEEN ${SQFT_MIN} AND ${SQFT_MAX} THEN ClosePrice / LivingArea END`;
const SALE_TO_LIST = "CASE WHEN ListPrice > 0 THEN ClosePrice / ListPrice END";

// Middle value of column `col` in CTE `src` (average of the two middle values when the count is even)
function medianOf(col: string, src = "s") {
  return `(SELECT AVG(v) FROM (
      SELECT ${col} AS v, ROW_NUMBER() OVER (ORDER BY ${col}) AS rn, COUNT(*) OVER () AS c
      FROM ${src} WHERE ${col} IS NOT NULL
    ) m WHERE rn IN (FLOOR((c + 1) / 2), CEIL((c + 1) / 2)))`;
}

// One row: count, median/avg price, $/sqft, DOM, sale-to-list, % over asking, date span
export function buildMarketSummaryQuery(place: string, opts: MarketOptions = {}) {
  const { whereSql, params, months } = soldWhere(place, opts);
  const sql = `WITH s AS (
    SELECT ClosePrice AS price, ${PPSF} AS ppsf, DaysOnMarket AS dom,
      ${SALE_TO_LIST} AS stl, ${CLOSE_DATE} AS closeDate
    FROM california_sold
    WHERE ${whereSql}
  )
  SELECT
    (SELECT COUNT(*) FROM s) AS soldCount,
    ${medianOf("price")} AS medianPrice,
    (SELECT ROUND(AVG(price)) FROM s) AS avgPrice,
    ${medianOf("ppsf")} AS medianPpsf,
    ${medianOf("dom")} AS medianDom,
    (SELECT ROUND(AVG(dom), 1) FROM s) AS avgDom,
    (SELECT ROUND(AVG(stl) * 100, 1) FROM s) AS saleToListPct,
    (SELECT ROUND(100 * SUM(stl > 1) / NULLIF(COUNT(stl), 0), 1) FROM s) AS pctOverAsking,
    (SELECT MIN(closeDate) FROM s) AS firstClose,
    (SELECT MAX(closeDate) FROM s) AS lastClose,
    (SELECT MIN(${CLOSE_DATE}) FROM california_sold WHERE ${CLOSE_DATE} <= CURDATE()) AS dataStart`;
  return { sql, params, months };
}

// One row per month: sales, median price, avg $/sqft, avg DOM
export function buildMonthlyTrendQuery(place: string, opts: MarketOptions = {}) {
  const { whereSql, params, months } = soldWhere(place, opts);
  const sql = `WITH s AS (
    SELECT DATE_FORMAT(${CLOSE_DATE}, '%Y-%m') AS ym, ClosePrice AS price,
      ${PPSF} AS ppsf, DaysOnMarket AS dom
    FROM california_sold
    WHERE ${whereSql}
  ),
  r AS (
    SELECT ym, price, ppsf, dom,
      ROW_NUMBER() OVER (PARTITION BY ym ORDER BY price) AS rn,
      COUNT(*) OVER (PARTITION BY ym) AS c
    FROM s
  )
  SELECT ym,
    COUNT(*) AS sold,
    AVG(CASE WHEN rn IN (FLOOR((c + 1) / 2), CEIL((c + 1) / 2)) THEN price END) AS medianPrice,
    ROUND(AVG(ppsf)) AS avgPpsf,
    ROUND(AVG(dom), 1) AS avgDom
  FROM r
  GROUP BY ym
  ORDER BY ym`;
  return { sql, params, months };
}

// Top ZIP codes in a city by number of sales
export function buildZipBreakdownQuery(place: string, opts: MarketOptions = {}, limit = 5) {
  const { whereSql, params, months } = soldWhere(place, opts);
  const n = clampInt(limit, 1, 20, 5);
  const sql = `SELECT PostalCode AS zip, COUNT(*) AS sold,
    ROUND(AVG(ClosePrice)) AS avgPrice,
    ROUND(AVG(${PPSF})) AS avgPpsf
  FROM california_sold
  WHERE ${whereSql}
    AND PostalCode IS NOT NULL AND PostalCode <> ''
  GROUP BY PostalCode
  ORDER BY sold DESC, zip
  LIMIT ${n}`;
  return { sql, params, months };
}

// Active listings right now (for inventory and months of supply)
export function buildActiveInventoryQuery(place: string, opts: MarketOptions = {}) {
  const where = [
    "(L_Status = 'Active' OR StandardStatus = 'Active')",
    isZip(place) ? "L_Zip = ?" : "L_City = ?",
    `L_SystemPrice BETWEEN ${PRICE_MIN} AND ${PRICE_MAX}`,
  ];
  const params: (string | number)[] = [place.trim()];
  if (opts.type) { where.push("L_Type_ = ?"); params.push(opts.type); }
  if (opts.beds != null) { where.push("L_Keyword2 >= ?"); params.push(Number(opts.beds)); }
  const sql = `WITH a AS (
    SELECT L_SystemPrice AS price, DaysOnMarket AS dom
    FROM rets_property
    WHERE ${where.join("\n      AND ")}
  )
  SELECT
    (SELECT COUNT(*) FROM a) AS activeCount,
    ${medianOf("price", "a")} AS medianListPrice,
    ${medianOf("dom", "a")} AS medianActiveDom`;
  return { sql, params };
}
