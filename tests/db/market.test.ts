// Week 5 integration tests against MySQL (npm run test:db).
// On the real data these check behaviour. On the fake fixture (tests/fixtures/sample_db.sql)
// they also check exact numbers, so the median SQL is proven correct.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getMarketReport, compareMarkets } from "../../src/market/marketStats.ts";
import { query, closePool } from "../../src/db/pool.ts";

after(closePool);

async function isFixture(): Promise<boolean> {
  const rows = await query<{ n: number }>("SELECT COUNT(*) AS n FROM california_sold WHERE UnparsedAddress = ?", ["1 Tustin Sold"]);
  return Number(rows[0]?.n) === 1;
}

test("Irvine report: sane numbers, no future dates", async () => {
  const r = await getMarketReport("Irvine", { months: 12 });
  const s = r.summary;
  assert.ok(s.soldCount >= 0);
  if (s.soldCount) {
    assert.ok(s.medianPrice! >= 10_000 && s.medianPrice! <= 100_000_000);
    assert.ok(s.lastClose! <= new Date().toISOString().slice(0, 10), "no future close dates");
    assert.ok(r.trend.reduce((n, m) => n + m.sold, 0) === s.soldCount, "monthly counts add up");
    if (s.medianPpsf != null) assert.ok(s.medianPpsf > 0);
  }
  assert.ok(r.inventory.activeCount >= 0);
  assert.ok(r.zips.length <= 5);
});

test("a narrower filter never has more sales", async () => {
  const all = await getMarketReport("Irvine", { months: 12 });
  const condos = await getMarketReport("Irvine", { months: 12, type: "Condominium" });
  const recent = await getMarketReport("Irvine", { months: 1 });
  assert.ok(condos.summary.soldCount <= all.summary.soldCount);
  assert.ok(recent.summary.soldCount <= all.summary.soldCount);
});

test("unknown city / injection just finds nothing", async () => {
  const r = await getMarketReport("Irvine' OR '1'='1", {});
  assert.equal(r.summary.soldCount, 0);
  assert.equal(r.inventory.activeCount, 0);
});

test("compare returns one report per city", async () => {
  const rs = await compareMarkets(["Irvine", "Tustin"], { months: 12 });
  assert.deepEqual(rs.map((r) => r.place), ["Irvine", "Tustin"]);
});

test("exact numbers on the fixture (skipped on real data)", async (t) => {
  if (!(await isFixture())) return t.skip("not the fixture database");
  const r = await getMarketReport("Tustin", { months: 12 });
  assert.equal(r.summary.soldCount, 5, "lease and $1 typo excluded");
  assert.equal(r.summary.medianPrice, 900_000);
  assert.equal(r.summary.avgPrice, 1_180_000);
  assert.equal(r.summary.medianPpsf, 900);
  assert.equal(r.summary.medianDom, 30);
  assert.equal(r.summary.pctOverAsking, 40);
  assert.equal(r.inventory.activeCount, 2);
  assert.equal(r.zips[0].zip, "92782");
  const condos = await getMarketReport("Tustin", { months: 12, type: "Condominium" });
  assert.equal(condos.summary.medianPrice, 750_000, "even count -> average of the middle two");
});
