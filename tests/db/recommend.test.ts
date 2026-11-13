// Week 7 integration tests against MySQL (npm run test:db).
// Exact-number checks only run on the fake fixture (tests/fixtures/sample_db.sql).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { recommend, liveRecDeps } from "../../src/recommend/recommend.ts";
import { query, closePool } from "../../src/db/pool.ts";

after(closePool);
const deps = liveRecDeps();

async function isFixture(): Promise<boolean> {
  const rows = await query<{ n: number }>("SELECT COUNT(*) AS n FROM california_sold WHERE UnparsedAddress = ?", ["20 Sold St"]);
  return Number(rows[0]?.n) === 1;
}

test("Irvine picks: active only, ranked, max 50, scores 0-100", async () => {
  const r = await recommend({ filters: { city: "Irvine" } }, deps);
  assert.ok(r.ranked.length <= 50);
  assert.ok(r.poolSize <= 200);
  for (let i = 0; i < r.ranked.length; i++) {
    const s = r.ranked[i];
    assert.equal(s.listing.L_City, "Irvine");
    assert.ok(s.score >= 0 && s.score <= 100);
  }
  assert.ok(!r.ranked.some((s) => s.listing.status === "Pending"));
});

test("benchmarks come back as same-type medians", async () => {
  const b = await deps.benchmarks("Irvine", ["92618"]);
  for (const row of b) {
    assert.ok(["zip_type", "city_type"].includes(row.level));
    assert.ok(row.n > 0);
    if (row.medianPpsf != null) assert.ok(row.medianPpsf > 0);
  }
});

test("injection in the city just finds nothing", async () => {
  const r = await recommend({ filters: { city: "Irvine' OR '1'='1" } }, deps);
  assert.equal(r.ranked.length, 0);
});

test("exact numbers on the fixture (skipped on real data)", async (t) => {
  if (!(await isFixture())) return t.skip("not the fixture database");
  const b = await deps.benchmarks("Irvine", ["92618", "92612"]);
  const zip = b.find((x) => x.level === "zip_type" && x.zip === "92618" && x.subtype === "Condominium")!;
  assert.equal(zip.n, 4, "lease, typo date and blank row excluded");
  assert.equal(Math.round(zip.medianPpsf!), 875);
  const city = b.find((x) => x.level === "city_type" && x.subtype === "Condominium")!;
  assert.equal(city.n, 5);
  assert.equal(Math.round(city.medianPpsf!), 850);

  const r = await recommend({ filters: { city: "Irvine", type: "Condominium", beds: 3, maxPrice: 1_300_000 } }, deps);
  assert.equal(r.ranked[0].listing.L_ListingID, "1001", "the below-median condo wins");
  assert.equal(r.ranked[0].discountPct, 9.4);
  assert.equal(r.history["1007"]?.ClosePrice, 1_100_000, "sold history via ListingKey join");

  const sim = await recommend({ filters: {}, anchorId: "1001" }, deps);
  assert.ok(!sim.ranked.some((s) => s.listing.L_ListingID === "1001"));
  assert.ok(sim.ranked.every((s) => s.listing.type === "Condominium" && s.listing.L_City === "Irvine"));
});
