// Week 3 integration tests: run real queries against MySQL.
// Uses whatever database .env points to. Against the real MLS data these check
// behaviour (filters respected, max 50 rows), not exact counts.
//   npm run test:db
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { searchActiveListings, getSoldComps, getCompsSummary } from "../../src/db/listings.ts";
import { closePool } from "../../src/db/pool.ts";

after(closePool);

test("Irvine search returns only Irvine, within budget, sorted by price", async () => {
  const r = await searchActiveListings({ city: "Irvine", maxPrice: 1_500_000 }, { limit: 10 });
  assert.ok(r.total >= r.listings.length);
  for (const l of r.listings) {
    assert.equal(l.L_City, "Irvine");
    assert.ok(Number(l.price) <= 1_500_000);
  }
  const prices = r.listings.map((l) => Number(l.price));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
});

test("bed/bath minimums are respected", async () => {
  const r = await searchActiveListings({ beds: 3, baths: 2 }, { limit: 20 });
  for (const l of r.listings) {
    assert.ok(Number(l.beds) >= 3);
    assert.ok(Number(l.baths) >= 2);
  }
});

test("never more than 50 rows, even if asked for 500", async () => {
  const r = await searchActiveListings({}, { limit: 500 });
  assert.ok(r.listings.length <= 50);
  assert.equal(r.limit, 50);
});

test("page 2 doesn't repeat page 1", async () => {
  const p1 = await searchActiveListings({}, { limit: 5, page: 1 });
  const p2 = await searchActiveListings({}, { limit: 5, page: 2 });
  const ids1 = new Set(p1.listings.map((l) => l.L_ListingID));
  for (const l of p2.listings) assert.ok(!ids1.has(l.L_ListingID));
});

test("SQL injection attempt just finds nothing", async () => {
  const r = await searchActiveListings({ city: "Irvine' OR '1'='1" });
  assert.equal(r.total, 0);
});

test("comps: residential, past dates only, within window", async () => {
  const comps = await getSoldComps("Irvine", { months: 12, limit: 50 });
  const now = Date.now();
  const yearAgo = now - 366 * 24 * 3600 * 1000;
  for (const c of comps) {
    const t = new Date(c.closeDate as any).getTime();
    assert.ok(t <= now, "no future close dates");
    assert.ok(t >= yearAgo, "inside the 12 month window");
    assert.ok(c.ClosePrice > 0);
  }
  const s = await getCompsSummary("Irvine");
  assert.ok(s.soldCount >= comps.length);
});
