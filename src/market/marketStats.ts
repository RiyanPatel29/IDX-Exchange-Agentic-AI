// Week 5: market report = closed-sales stats + monthly trend + ZIPs + active inventory.
import { query } from "../db/pool.ts";
import {
  buildMarketSummaryQuery, buildMonthlyTrendQuery, buildZipBreakdownQuery, buildActiveInventoryQuery,
  type MarketOptions,
} from "./marketQueries.ts";

export interface MarketSummary {
  soldCount: number;
  medianPrice: number | null; avgPrice: number | null;
  medianPpsf: number | null;
  medianDom: number | null; avgDom: number | null;
  saleToListPct: number | null; pctOverAsking: number | null;
  firstClose: string | null; lastClose: string | null;
  dataStart: string | null;   // earliest sale in the whole table (the export starts Mar 2026)
}
export interface MonthRow { ym: string; sold: number; medianPrice: number | null; avgPpsf: number | null; avgDom: number | null }
export interface ZipRow { zip: string; sold: number; avgPrice: number | null; avgPpsf: number | null }
export interface Inventory { activeCount: number; medianListPrice: number | null; medianActiveDom: number | null }

export interface MarketReport {
  place: string;
  months: number;
  type: string | null;
  beds: number | null;
  summary: MarketSummary;
  trend: MonthRow[];
  zips: ZipRow[];
  inventory: Inventory;
  // derived
  monthsCovered: number;              // the data only starts in Mar 2026, so this can be < months
  monthlySales: number | null;        // closed sales per month
  monthsOfSupply: number | null;      // active listings / monthly sales
  temperature: "seller" | "balanced" | "buyer" | null;
  trendChangePct: number | null;      // median price, first full month vs last full month
  trendFrom: string | null;
  trendTo: string | null;
}

const toNum = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const toDateStr = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

const DAY = 24 * 3600 * 1000;

// How many months of data we really have (window could be 12 but the export starts in March)
export function monthsCovered(firstClose: string | null, months: number, today = new Date()): number {
  if (!firstClose) return 0;
  const days = (today.getTime() - new Date(firstClose + "T00:00:00Z").getTime()) / DAY;
  return Math.max(1, Math.min(months, Math.round((days / 30.44) * 10) / 10));
}

// < 3 months of supply = seller's market, 3-6 balanced, > 6 buyer's (common industry rule of thumb)
export function marketTemperature(monthsOfSupply: number | null): MarketReport["temperature"] {
  if (monthsOfSupply == null) return null;
  if (monthsOfSupply < 3) return "seller";
  if (monthsOfSupply <= 6) return "balanced";
  return "buyer";
}

// Median price change between the first and last *complete* months with enough sales
export function trendChange(rows: MonthRow[], today = new Date(), minSales = 3) {
  const thisMonth = today.toISOString().slice(0, 7);
  const full = rows.filter((r) => r.ym !== thisMonth && r.sold >= minSales && r.medianPrice);
  if (full.length < 2) return { pct: null, from: null, to: null };
  const first = full[0], last = full[full.length - 1];
  const pct = Math.round(((Number(last.medianPrice) - Number(first.medianPrice)) / Number(first.medianPrice)) * 1000) / 10;
  return { pct, from: first.ym, to: last.ym };
}

export function deriveReport(
  place: string, opts: MarketOptions, months: number,
  summary: MarketSummary, trend: MonthRow[], zips: ZipRow[], inventory: Inventory, today = new Date(),
): MarketReport {
  const covered = monthsCovered(summary.dataStart ?? summary.firstClose, months, today);
  const monthlySales = summary.soldCount && covered ? Math.round((summary.soldCount / covered) * 10) / 10 : null;
  const mos = monthlySales ? Math.round((inventory.activeCount / monthlySales) * 10) / 10 : null;
  const t = trendChange(trend, today);
  return {
    place, months, type: opts.type ?? null, beds: opts.beds ?? null,
    summary, trend, zips, inventory,
    monthsCovered: covered, monthlySales, monthsOfSupply: mos,
    temperature: marketTemperature(mos),
    trendChangePct: t.pct, trendFrom: t.from, trendTo: t.to,
  };
}

export async function getMarketReport(place: string, opts: MarketOptions = {}): Promise<MarketReport> {
  const qs = buildMarketSummaryQuery(place, opts);
  const qt = buildMonthlyTrendQuery(place, opts);
  const qz = buildZipBreakdownQuery(place, opts);
  const qi = buildActiveInventoryQuery(place, opts);
  const [[s], trendRows, zipRows, [inv]] = await Promise.all([
    query<any>(qs.sql, qs.params),
    query<any>(qt.sql, qt.params),
    query<any>(qz.sql, qz.params),
    query<any>(qi.sql, qi.params),
  ]);

  const summary: MarketSummary = {
    soldCount: Number(s?.soldCount ?? 0),
    medianPrice: toNum(s?.medianPrice), avgPrice: toNum(s?.avgPrice),
    medianPpsf: toNum(s?.medianPpsf),
    medianDom: toNum(s?.medianDom), avgDom: toNum(s?.avgDom),
    saleToListPct: toNum(s?.saleToListPct), pctOverAsking: toNum(s?.pctOverAsking),
    firstClose: toDateStr(s?.firstClose), lastClose: toDateStr(s?.lastClose),
    dataStart: toDateStr(s?.dataStart),
  };
  const trend: MonthRow[] = trendRows.map((r) => ({
    ym: String(r.ym), sold: Number(r.sold), medianPrice: toNum(r.medianPrice),
    avgPpsf: toNum(r.avgPpsf), avgDom: toNum(r.avgDom),
  }));
  const zips: ZipRow[] = zipRows.map((r) => ({
    zip: String(r.zip), sold: Number(r.sold), avgPrice: toNum(r.avgPrice), avgPpsf: toNum(r.avgPpsf),
  }));
  const inventory: Inventory = {
    activeCount: Number(inv?.activeCount ?? 0),
    medianListPrice: toNum(inv?.medianListPrice), medianActiveDom: toNum(inv?.medianActiveDom),
  };
  return deriveReport(place, opts, qs.months, summary, trend, zips, inventory);
}

// Several cities side by side (max 5, run one after another to keep the pool light)
export async function compareMarkets(places: string[], opts: MarketOptions = {}): Promise<MarketReport[]> {
  const out: MarketReport[] = [];
  for (const p of places.slice(0, 5)) out.push(await getMarketReport(p, opts));
  return out;
}
