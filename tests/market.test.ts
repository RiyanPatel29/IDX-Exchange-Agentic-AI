// Week 5: market stats logic (no database needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketSummaryQuery, buildMonthlyTrendQuery, buildZipBreakdownQuery, buildActiveInventoryQuery, isZip,
} from "../src/market/marketQueries.ts";
import { isMarketQuestion, parseMarketQuery, parseMonths, parseCompareCities } from "../src/market/parseMarketQuery.ts";
import {
  trendChange, marketTemperature, monthsCovered, deriveReport, type MarketSummary, type MonthRow,
} from "../src/market/marketStats.ts";
import { sparkline, shortMoney, formatMarketReport, formatComparison } from "../src/market/formatMarket.ts";
import { planMarket } from "../src/agent/marketIntent.ts";
import { newSession } from "../src/session/sessionStore.ts";

const TODAY = new Date("2026-11-06T12:00:00Z");

// ---------- SQL builders ----------

test("market SQL is parameterized; user text only in params", () => {
  const evil = "Irvine' OR 1=1; DROP TABLE california_sold; --";
  for (const b of [buildMarketSummaryQuery, buildMonthlyTrendQuery, buildZipBreakdownQuery, buildActiveInventoryQuery]) {
    const q = b(evil, { type: "Condominium", beds: 3 });
    assert.ok(!q.sql.includes("DROP TABLE"), b.name);
    assert.equal(q.params[0], evil);
    assert.deepEqual(q.params.slice(1), ["Condominium", 3]);
  }
});

test("sold filters: residential only, no future dates, sane prices, window clamped", () => {
  const q = buildMarketSummaryQuery("Irvine", { months: 9999 });
  assert.match(q.sql, /PropertyType = 'Residential'/);
  assert.match(q.sql, /<= CURDATE\(\)/);
  assert.match(q.sql, /ClosePrice BETWEEN 10000 AND 100000000/);
  assert.match(q.sql, /INTERVAL 120 MONTH/);
  assert.equal(q.months, 120);
  assert.equal(buildMarketSummaryQuery("Irvine", { months: "abc" as any }).months, 12);
});

test("a ZIP code filters on PostalCode / L_Zip", () => {
  assert.ok(isZip("92618"));
  assert.ok(!isZip("Irvine"));
  assert.match(buildMarketSummaryQuery("92618").sql, /PostalCode = \?/);
  assert.match(buildActiveInventoryQuery("92618").sql, /L_Zip = \?/);
});

test("medians use window functions, not AVG", () => {
  const q = buildMarketSummaryQuery("Irvine");
  assert.match(q.sql, /ROW_NUMBER\(\) OVER \(ORDER BY price\)/);
  assert.match(buildMonthlyTrendQuery("Irvine").sql, /PARTITION BY ym/);
});

// ---------- understanding questions ----------

test("market questions vs listing searches", () => {
  for (const t of [
    "how's the Irvine condo market?", "what are homes selling for in Tustin", "median price in San Diego",
    "price per sqft in Irvine", "compare Irvine vs Tustin", "recent sales in Irvine", "is Tustin a buyer's market?",
    "days on market in Irvine", "are prices going up in Irvine",
  ]) assert.ok(isMarketQuestion(t), t);
  for (const t of ["3 bed condos in Irvine under 1.5M", "homes in Irvine with a hot tub", "more", "tell me about #2"]) {
    assert.ok(!isMarketQuestion(t), t);
  }
});

test("time windows", () => {
  assert.equal(parseMonths("last 6 months"), 6);
  assert.equal(parseMonths("past 90 days"), 3);
  assert.equal(parseMonths("last 2 years"), 24);
  assert.equal(parseMonths("last quarter"), 3);
  assert.equal(parseMonths("lately"), 6);
  assert.equal(parseMonths("this year", TODAY), 11);
  assert.equal(parseMonths("how's the market"), 12);
});

test("cities, type and beds", () => {
  const q = parseMarketQuery("median price for 3 bed condos in Irvine last 6 months");
  assert.deepEqual(q, { cities: ["Irvine"], months: 6, type: "Condominium", beds: 3, compare: false, wantsRecentSales: false });
  assert.deepEqual(parseMarketQuery("how is the Yorba Linda market").cities, ["Yorba Linda"]);
  assert.ok(parseMarketQuery("recent sales in Tustin").wantsRecentSales);
});

test("compare several cities", () => {
  assert.deepEqual(parseCompareCities("compare Irvine vs Tustin vs Lake Forest"), ["Irvine", "Tustin", "Lake Forest"]);
  assert.deepEqual(parseCompareCities("compare Irvine, Tustin and Yorba Linda condos"), ["Irvine", "Tustin", "Yorba Linda"]);
  assert.deepEqual(parseCompareCities("Irvine vs Newport Beach last 6 months"), ["Irvine", "Newport Beach"]);
  const q = parseMarketQuery("compare Irvine and Tustin condo prices");
  assert.ok(q.compare);
  assert.equal(q.type, "Condominium");
});

// ---------- derived numbers ----------

const months = (vals: [string, number, number][]): MonthRow[] =>
  vals.map(([ym, sold, medianPrice]) => ({ ym, sold, medianPrice, avgPpsf: null, avgDom: null }));

test("trend skips the current (partial) month and thin months", () => {
  const t = trendChange(months([
    ["2026-05", 10, 1_000_000], ["2026-06", 1, 5_000_000], ["2026-10", 12, 1_100_000], ["2026-11", 4, 2_000_000],
  ]), TODAY);
  assert.deepEqual(t, { pct: 10, from: "2026-05", to: "2026-10" });
  assert.deepEqual(trendChange(months([["2026-10", 9, 1]]), TODAY), { pct: null, from: null, to: null });
});

test("market temperature from months of supply", () => {
  assert.equal(marketTemperature(1.5), "seller");
  assert.equal(marketTemperature(4), "balanced");
  assert.equal(marketTemperature(8), "buyer");
  assert.equal(marketTemperature(null), null);
});

test("months covered is capped by when the data starts", () => {
  assert.equal(monthsCovered("2026-03-18", 12, TODAY), 7.7);
  assert.equal(monthsCovered("2020-01-01", 12, TODAY), 12);
  assert.equal(monthsCovered(null, 12, TODAY), 0);
});

const summary = (over: Partial<MarketSummary> = {}): MarketSummary => ({
  soldCount: 80, medianPrice: 1_180_000, avgPrice: 1_240_000, medianPpsf: 812, medianDom: 14, avgDom: 19,
  saleToListPct: 99.2, pctOverAsking: 38, firstClose: "2026-03-20", lastClose: "2026-11-03", dataStart: "2026-03-08",
  ...over,
});

test("months of supply = active / monthly sales", () => {
  const r = deriveReport("Irvine", {}, 12, summary(), [], [], { activeCount: 40, medianListPrice: 1_250_000, medianActiveDom: 20 }, TODAY);
  assert.equal(r.monthsCovered, 8);
  assert.equal(r.monthlySales, 10);
  assert.equal(r.monthsOfSupply, 4);
  assert.equal(r.temperature, "balanced");
});

// ---------- formatting ----------

test("sparkline and short money", () => {
  assert.equal(sparkline([1, 2, 3, 4, 5, 6, 7, 8]), "▁▂▃▄▅▆▇█");
  assert.equal(sparkline([5]), "");
  assert.equal(shortMoney(1_180_000), "$1.18M");
  assert.equal(shortMoney(2_000_000), "$2M");
  assert.equal(shortMoney(845_000), "$845K");
});

test("report text has the key numbers and a data-window note", () => {
  const r = deriveReport("Irvine", { type: "Condominium" }, 12, summary(),
    months([["2026-09", 10, 1_150_000], ["2026-10", 12, 1_200_000]]), [],
    { activeCount: 40, medianListPrice: 1_250_000, medianActiveDom: 20 }, TODAY);
  const text = formatMarketReport(r);
  assert.match(text, /Irvine condominium market, last 12 months/);
  assert.match(text, /Median sale \$1,180,000/);
  assert.match(text, /\$812\/sqft/);
  assert.match(text, /4 months of supply/);
  assert.match(text, /Balanced market/);
  assert.match(text, /covers about 8 months, not 12/);
});

test("no sales -> friendly message", () => {
  const r = deriveReport("Nowhere", {}, 12, summary({ soldCount: 0 }), [], [], { activeCount: 0, medianListPrice: null, medianActiveDom: null }, TODAY);
  assert.match(formatMarketReport(r), /No closed residential sales found in Nowhere/);
});

test("comparison names the best value and fastest city", () => {
  const inv = { activeCount: 10, medianListPrice: 1, medianActiveDom: 1 };
  const a = deriveReport("Irvine", {}, 12, summary({ medianPpsf: 800, medianDom: 20 }), [], [], inv, TODAY);
  const b = deriveReport("Tustin", {}, 12, summary({ medianPpsf: 650, medianDom: 9, saleToListPct: 101.5 }), [], [], inv, TODAY);
  const text = formatComparison([a, b]);
  assert.match(text, /Best value per sqft: Tustin/);
  assert.match(text, /Fastest selling: Tustin \(9 days\)/);
  assert.match(text, /Strongest offers: Tustin/);
});

// ---------- routing ----------

test("planMarket: questions, missing city, and follow-ups", () => {
  const s = newSession("u");
  assert.deepEqual(planMarket("how's the Irvine condo market?", s),
    { kind: "market", cities: ["Irvine"], months: 12, type: "Condominium", beds: null, wantsRecentSales: false });
  assert.equal(planMarket("how's the market?", s)!.kind, "need_market_city");
  assert.equal(planMarket("3 bed condos in Irvine", s), null);

  // after an Irvine market answer
  const after = { ...s, lastIntent: "market", lastMarket: { cities: ["Irvine"], months: 12, type: "Condominium", beds: null } };
  assert.deepEqual((planMarket("what about Tustin?", after) as any).cities, ["Tustin"]);
  assert.deepEqual((planMarket("compare it with Tustin", after) as any).cities, ["Irvine", "Tustin"]);
  assert.equal((planMarket("last 3 months", after) as any).months, 3);
  assert.equal(planMarket("show me condos in Tustin under 900k", after), null, "that's a listing search");

  // "how's the market?" right after a search uses that city
  const searched = { ...s, lastIntent: "search", filters: { city: "Tustin", type: "Townhouse" } };
  assert.deepEqual(planMarket("how's the market there?", searched),
    { kind: "market", cities: ["Tustin"], months: 12, type: "Townhouse", beds: null, wantsRecentSales: false });
});
