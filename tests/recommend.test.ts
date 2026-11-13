// Week 7: recommendation engine (no database needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  relaxFilters, buildPoolQuery, buildBenchmarksQuery, buildSoldHistoryQuery, similarFilters, MAX_POOL,
} from "../src/recommend/recQueries.ts";
import {
  ppsf, benchmarkFor, fitScore, valueScore, freshScore, tasteScore, similarity, scoreListing, rank,
  type Benchmark,
} from "../src/recommend/score.ts";
import { recommend, type RecDeps } from "../src/recommend/recommend.ts";
import { parseRecIntent, refsIn } from "../src/recommend/recIntent.ts";
import { formatRecPage, recCard } from "../src/recommend/formatRec.ts";
import { handleMessage, type Deps } from "../src/agent/handleMessage.ts";
import { MemorySessionStore, newSession } from "../src/session/sessionStore.ts";
import type { ListingRow } from "../src/db/listings.ts";

function home(id: string, extra: Partial<ListingRow> = {}): ListingRow {
  return {
    L_ListingID: id, L_DisplayId: `MLS${id}`, L_Address: `${id} Main St`, L_City: "Irvine", L_Zip: "92618",
    price: 1_000_000, beds: 3, baths: 2, sqft: 1250, type: "Condominium", status: "Active", lat: null, lng: null,
    YearBuilt: 2010, AssociationFee: 300, DaysOnMarket: 20, PoolPrivateYN: "False", ViewYN: "False",
    FireplaceYN: "False", PhotoCount: 10, LA1_UserFirstName: null, LA1_UserLastName: null,
    LO1_OrganizationName: null, ...extra,
  };
}

const BENCH: Benchmark[] = [
  { level: "zip_type", zip: "92618", subtype: "Condominium", n: 10, medianPpsf: 1000 },
  { level: "zip_type", zip: "92620", subtype: "Condominium", n: 2, medianPpsf: 500 },   // too few sales
  { level: "city_type", zip: null, subtype: "Condominium", n: 40, medianPpsf: 900 },
  { level: "city_type", zip: null, subtype: "SingleFamilyResidence", n: 3, medianPpsf: 700 }, // too few
];

// ---------- SQL ----------

test("relaxed pool: some slack on budget/beds/size, pool and view become soft", () => {
  assert.deepEqual(
    relaxFilters({ city: "Irvine", maxPrice: 1_000_000, beds: 3, sqft: 1500, pool: "True", hasView: "True", maxHoa: 400 }),
    { city: "Irvine", maxPrice: 1_100_000, beds: 2, sqft: 1350, maxHoa: 500 },
  );
  assert.equal(relaxFilters({ beds: 1 }).beds, 1);
  assert.equal(relaxFilters({ maxHoa: 0 }).maxHoa, 0, "no HOA stays strict");
});

test("pool query is parameterized, capped, can exclude the anchor", () => {
  const evil = "Irvine' OR 1=1; DROP TABLE rets_property; --";
  const q = buildPoolQuery({ city: evil }, { max: 99999, excludeId: "42" });
  assert.ok(!q.sql.includes("DROP TABLE"));
  assert.ok(q.params.includes(evil));
  assert.match(q.sql, new RegExp(`LIMIT ${MAX_POOL}$`));
  assert.match(q.sql, /L_ListingID <> \?/);
  assert.equal(q.params.at(-1), "42");
});

test("benchmarks: same-type medians by ZIP and city, aggregates only", () => {
  const q = buildBenchmarksQuery("Irvine", ["92618", "92620", "92618", "bad'zip"]);
  assert.deepEqual(q.params, ["Irvine", "92618", "92620", "Irvine"], "dedupes ZIPs and drops junk");
  assert.match(q.sql, /PARTITION BY PostalCode, PropertySubType/);
  assert.match(q.sql, /PARTITION BY City, PropertySubType/);
  assert.match(q.sql, /PropertyType = 'Residential'/);
  assert.match(q.sql, /<= CURDATE\(\)/);
  assert.match(buildBenchmarksQuery("Irvine", []).sql, /1 = 0/);
});

test("sold history uses the ListingKey join, numeric ids only, max 50", () => {
  const q = buildSoldHistoryQuery(["1007", "abc", "12; DROP", ...Array.from({ length: 80 }, (_, i) => String(i + 1))])!;
  assert.match(q.sql, /ListingKey IN \(/);
  assert.equal(q.params[0], 1007);
  assert.ok(q.params.every((p) => typeof p === "number"));
  assert.equal(q.params.length, 50);
  assert.equal(buildSoldHistoryQuery(["x"]), null);
});

test("similar filters: same city/type, ±25% price, ±1 bed after relaxing", () => {
  const f = similarFilters({ L_City: "Irvine", type: "Condominium", price: 1_000_000, beds: 3 });
  const r = relaxFilters(f);
  assert.equal(r.city, "Irvine");
  assert.equal(r.minPrice, 750_000);
  assert.ok(Math.abs(r.maxPrice! - 1_250_000) <= 1);
  assert.equal(r.beds, 2);
});

// ---------- scoring ----------

test("$/sqft ignores junk sizes", () => {
  assert.equal(ppsf({ price: 900_000, sqft: 1000 }), 900);
  assert.equal(ppsf({ price: 900_000, sqft: 5 }), null);
  assert.equal(ppsf({ price: null, sqft: 1000 }), null);
});

test("benchmark: ZIP first, city fallback when the ZIP is thin, never another type", () => {
  assert.equal(benchmarkFor(home("a"), BENCH)!.label, "92618 condos");
  assert.equal(benchmarkFor(home("b", { L_Zip: "92620" }), BENCH)!.label, "Irvine condos");
  assert.equal(benchmarkFor(home("c", { type: "SingleFamilyResidence" }), BENCH), null);
});

test("value: 10% under the median scores full marks, overpriced scores low", () => {
  const cheap = valueScore(home("a", { price: 1_125_000 }), BENCH);   // $900 vs $1000
  assert.equal(cheap.pts, 35);
  assert.equal(cheap.discountPct, 10);
  assert.match(cheap.reason!, /10% below 92618 condos \(\$900 vs \$1000\/sqft, 10 recent sales\)/);
  const pricey = valueScore(home("b", { price: 1_500_000 }), BENCH);  // $1200, 20% over
  assert.equal(pricey.pts, 0);
  assert.match(pricey.reason!, /20% above/);
  assert.deepEqual(valueScore(home("c", { sqft: null }), BENCH), { pts: 17.5, discountPct: null, reason: null });
});

test("fit: budget, beds, pool, HOA", () => {
  const f = { maxPrice: 1_000_000, beds: 3, pool: "True" as const, maxHoa: 0 };
  const great = fitScore(home("a", { price: 900_000, PoolPrivateYN: "True", AssociationFee: 0 }), f);
  assert.equal(great.pts, 40);
  assert.deepEqual(great.reasons, ["$100,000 under your budget", "Has the pool you wanted", "No HOA"]);
  const meh = fitScore(home("b", { price: 1_050_000, beds: 2 }), f);
  assert.ok(meh.pts < 20);
  assert.ok(meh.reasons.includes("⚠️ 5% over budget"));
  assert.ok(meh.reasons.includes("⚠️ 2 beds (you asked for 3+)"));
  assert.ok(meh.reasons.includes("⚠️ No pool"));
});

test("freshness", () => {
  assert.equal(freshScore(home("a", { DaysOnMarket: 3 })).pts, 10);
  assert.match(freshScore(home("a", { DaysOnMarket: 120 })).reason!, /may be room to negotiate/);
});

test("similarity: identical = 1, very different is low", () => {
  const a = home("a");
  assert.equal(similarity(a, home("b")), 1);
  const far = home("c", { L_Zip: "92101", L_City: "San Diego", type: "SingleFamilyResidence", price: 3_000_000, beds: 6, sqft: 4000, PoolPrivateYN: "True", YearBuilt: 1950 });
  assert.ok(similarity(a, far) < 0.15);
});

test("taste: likes pull similar homes up, dislikes push them down, liked home is flagged", () => {
  const liked = home("L", { price: 1_000_000 });
  const twin = home("T", { price: 1_020_000 });
  const other = home("O", { L_Zip: "92620", type: "Townhouse", price: 700_000, beds: 2, sqft: 900 });
  const t = { liked: [liked], disliked: [] };
  assert.ok(tasteScore(twin, t).pts > tasteScore(other, t).pts);
  assert.match(tasteScore(twin, t).reason!, /Similar to L Main St you liked/);
  assert.deepEqual(tasteScore(liked, t), { pts: 15, reason: "❤️ On your liked list" });
  assert.ok(tasteScore(twin, { liked: [], disliked: [liked] }).pts < 7.5);
});

test("total score adds up and reasons lead with value", () => {
  const s = scoreListing(home("a", { price: 1_125_000, DaysOnMarket: 2 }), { filters: { maxPrice: 1_200_000 }, benchmarks: BENCH, taste: { liked: [], disliked: [] } });
  assert.equal(s.score, Math.round(s.parts.fit + s.parts.value + s.parts.fresh + s.parts.taste));
  assert.equal(s.parts.value, 35);
  assert.match(s.reasons[0], /^💲/);
  assert.ok(s.score <= 100);
});

test("rank: best first, disliked dropped, max 3 per ZIP in the top 5", () => {
  const mk = (id: string, zip: string, score: number) => ({ listing: home(id, { L_Zip: zip }), score, parts: { fit: 0, value: 0, fresh: 0, taste: 0 }, reasons: [], discountPct: null });
  const r = rank([
    mk("1", "A", 99), mk("2", "A", 98), mk("3", "A", 97), mk("4", "A", 96), mk("5", "B", 50), mk("6", "C", 40), mk("x", "C", 100),
  ], { excludeIds: new Set(["x"]) });
  assert.deepEqual(r.map((s) => s.listing.L_ListingID), ["1", "2", "3", "5", "6", "4"]);
  // only one ZIP available: still fills the top 5
  const one = rank([mk("1", "A", 9), mk("2", "A", 8), mk("3", "A", 7), mk("4", "A", 6)]);
  assert.equal(one.length, 4);
});

// ---------- engine with fake deps ----------

const POOL: ListingRow[] = [
  home("deal", { price: 1_125_000, DaysOnMarket: 3 }),                 // 10% under ZIP median
  home("fair", { price: 1_250_000, DaysOnMarket: 3 }),                 // at median
  home("over", { price: 1_600_000, DaysOnMarket: 3 }),                 // overpriced
  home("tow", { L_Zip: "92620", price: 1_000_000, DaysOnMarket: 40 }), // city benchmark
];

function fakeRecDeps(calls: any[] = []): RecDeps {
  const all = [...POOL, home("anchor", { price: 1_200_000 })];
  return {
    pool: async (f, o) => { calls.push({ pool: f, o }); return POOL.filter((l) => l.L_ListingID !== o.excludeId); },
    benchmarks: async (city, zips) => { calls.push({ city, zips }); return BENCH; },
    soldHistory: async (ids) => (ids.includes("deal") ? [{ ListingKey: "deal" as any, ClosePrice: 1_000_000, closeDate: "2026-04-02" }] : []),
    byIds: async (ids) => all.filter((l) => ids.includes(String(l.L_ListingID))),
  };
}

test("recommend: value wins, benchmarks fetched for the pool's ZIPs", async () => {
  const calls: any[] = [];
  const r = await recommend({ filters: { city: "Irvine", maxPrice: 1_700_000 } }, fakeRecDeps(calls));
  assert.equal(r.ranked[0].listing.L_ListingID, "deal");
  assert.equal(r.ranked.at(-1)!.listing.L_ListingID, "over");
  assert.deepEqual(calls[1], { city: "Irvine", zips: ["92618", "92620"] });
  assert.equal(r.poolSize, 4);
});

test("recommend: dislikes are removed, anchor excluded from its own 'similar' list", async () => {
  const r = await recommend({ filters: { city: "Irvine" }, dislikedIds: ["deal"] }, fakeRecDeps());
  assert.ok(!r.ranked.some((s) => s.listing.L_ListingID === "deal"));
  const calls: any[] = [];
  const sim = await recommend({ filters: {}, anchorId: "anchor" }, fakeRecDeps(calls));
  assert.equal(sim.anchor!.L_ListingID, "anchor");
  assert.equal(calls[0].o.excludeId, "anchor");
  assert.equal(calls[0].pool.city, "Irvine");
  const gone = await recommend({ filters: {}, anchorId: "nope" }, fakeRecDeps());
  assert.equal(gone.ranked.length, 0);
});

// ---------- understanding messages ----------

test("recommendation intents", () => {
  assert.deepEqual(parseRecIntent("recommend 3 bed condos in Irvine"), { kind: "recommend" });
  assert.deepEqual(parseRecIntent("best deals in Tustin"), { kind: "recommend" });
  assert.deepEqual(parseRecIntent("any underpriced homes in Irvine?"), { kind: "recommend" });
  assert.deepEqual(parseRecIntent("what do you recommend"), { kind: "recommend" });
  assert.deepEqual(parseRecIntent("homes like #2"), { kind: "similar", index: 2 });
  assert.deepEqual(parseRecIntent("show me more like the second one"), { kind: "similar", index: 2 });
  assert.deepEqual(parseRecIntent("similar to this one"), { kind: "similar", index: "this" });
  assert.deepEqual(parseRecIntent("I like #2"), { kind: "like", indexes: [2] });
  assert.deepEqual(parseRecIntent("i love #1 and #4"), { kind: "like", indexes: [1, 4] });
  assert.deepEqual(parseRecIntent("#3 looks great"), { kind: "like", indexes: [3] });
  assert.deepEqual(parseRecIntent("👍 2"), { kind: "like", indexes: [2] });
  assert.deepEqual(parseRecIntent("not #3"), { kind: "dislike", indexes: [3] });
  assert.deepEqual(parseRecIntent("hide number 4"), { kind: "dislike", indexes: [4] });
  assert.deepEqual(parseRecIntent("my favorites"), { kind: "favorites" });
  assert.deepEqual(parseRecIntent("clear my likes"), { kind: "clear_taste" });
  // not recommendation messages
  for (const t of ["3 bed condos in Irvine", "more", "tell me about #2", "no HOA", "not 3 beds, 2 is fine", "how's the market?"]) {
    assert.equal(parseRecIntent(t), null, t);
  }
});

test("refsIn", () => {
  assert.deepEqual(refsIn("#2 and #5"), [2, 5]);
  assert.deepEqual(refsIn("the third one"), [3]);
  assert.deepEqual(refsIn("that one"), ["this"]);
});

// ---------- formatting ----------

test("rec card shows score, top 3 reasons and sold history", () => {
  const card = recCard(home("a", { price: 1_150_000 }), { id: "a", score: 88, reasons: ["r1", "r2", "r3", "r4"] }, 1,
    { ListingKey: 1, ClosePrice: 1_000_000, closeDate: "2026-04-02" });
  assert.match(card, /⭐ Match 88\/100/);
  assert.match(card, /• r3/);
  assert.ok(!card.includes("r4"));
  assert.match(card, /📜 Last sold \$1,000,000 in Apr 2026 \(now \+15%\)/);
});

test("rec page header and empty states", () => {
  const out = formatRecPage({ rows: [home("a")], items: [{ id: "a", score: 70, reasons: [] }], start: 1, total: 8, poolSize: 120, filters: { city: "Irvine" }, liked: 2 });
  assert.match(out, /🎯 \*Top picks: Irvine\*/);
  assert.match(out, /Ranked 120 active listings .* tuned to the 2 homes you liked/);
  assert.match(out, /Reply "more"/);
  assert.match(formatRecPage({ rows: [], items: [], start: 1, total: 0, poolSize: 0, filters: { city: "Nowhere" }, liked: 0 }), /No active listings to recommend/);
});

// ---------- conversations ----------

function chatDeps(store = new MemorySessionStore()) {
  const rec = fakeRecDeps();
  const deps: Deps = {
    store,
    async search(f) {
      const rows = POOL.filter((l) => !f.city || l.L_City === f.city);
      return { listings: rows.slice(0, 5), total: rows.length, page: 1, limit: 5, totalPages: 1 };
    },
    async getListing(id) { const l = POOL.find((x) => x.L_ListingID === id); return l ? { ...l, remarks: "Nice." } : null; },
    rec,
  };
  return deps;
}

test("conversation: picks, like, dislike, re-rank, favorites, similar", async () => {
  const deps = chatDeps();
  let r = await handleMessage("u", "best deals in Irvine", deps);
  assert.equal(r.intent, "recommend");
  assert.match(r.text!, /1\. 🏠 \*deal Main St/);
  assert.match(r.text!, /📜 Last sold \$1,000,000/);

  r = await handleMessage("u", "I like #2", deps);
  assert.equal(r.intent, "like");
  let s = await deps.store.get("u");
  assert.equal(s.liked.length, 1);

  r = await handleMessage("u", "not #1", deps);
  assert.equal(r.intent, "dislike");
  s = await deps.store.get("u");
  assert.deepEqual(s.disliked, ["deal"]);
  assert.ok(!s.recRanked.some((x) => x.id === "deal"), "hidden from current picks");

  r = await handleMessage("u", "recommend", deps);
  assert.ok(!r.text!.includes("deal Main St"), "disliked home never comes back");
  assert.match(r.text!, /tuned to the 1 home you liked/);

  r = await handleMessage("u", "my favorites", deps);
  assert.match(r.text!, /Your liked homes\* \(1\)/);

  r = await handleMessage("u", "homes like #1", deps);
  assert.equal(r.intent, "similar");
  assert.match(r.text!, /Top picks: homes like/);
});

test("conversation: refine after picks keeps recommending; sort goes back to plain search", async () => {
  const deps = chatDeps();
  await handleMessage("u", "recommend condos in Irvine", deps);
  let r = await handleMessage("u", "under 1.3M", deps);
  assert.equal(r.intent, "recommend");
  assert.match(r.text!, /Updated: max price \$1,300,000/);
  r = await handleMessage("u", "sort by cheapest first", deps);
  assert.match(r.text!, /^🔄 Updated: sorted by lowest price\n\nFound/);
});

test("conversation: asks for a city, likes need something on screen", async () => {
  const deps = chatDeps();
  let r = await handleMessage("u", "what do you recommend?", deps);
  assert.equal(r.intent, "need_city");
  r = await handleMessage("u", "Irvine", deps);
  assert.equal(r.intent, "recommend");
  r = await handleMessage("u", "I like #9", deps);
  assert.match(r.text!, /I can only see #1-#4/);
  const fresh = chatDeps();
  r = await handleMessage("v", "I like #2", fresh);
  assert.equal(r.text, null, "nothing on screen: not a property request");
});

test("likes survive the session timeout, the search doesn't", async () => {
  const store = new MemorySessionStore(0);
  const deps = chatDeps(store);
  await handleMessage("u", "best deals in Irvine", deps);
  const s = await store.get("u");
  s.liked = ["fair"];
  await store.save(s);
  await new Promise((res) => setTimeout(res, 5));
  const later = await store.get("u");
  assert.deepEqual(later.liked, ["fair"]);
  assert.deepEqual(later.filters, {});
  assert.deepEqual(newSession("x").liked, []);
});
