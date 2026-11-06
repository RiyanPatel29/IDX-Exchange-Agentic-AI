// Week 6 DB tests: the SQL side of semantic search (no embedding API needed).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getCandidateIds, getListingsByIds, getRemarksPage, searchActiveListings } from "../../src/db/listings.ts";
import { closePool } from "../../src/db/pool.ts";

after(closePool);

test("candidate ids match the normal search's filters", async () => {
  const f = { city: "Irvine", maxPrice: 1_500_000 };
  const ids = await getCandidateIds(f);
  const r = await searchActiveListings(f, { limit: 50 });
  assert.equal(ids.length, Math.min(r.total, 20_000));
  for (const l of r.listings) assert.ok(ids.includes(String(l.L_ListingID)));
});

test("fetch by ids returns those listings with remarks, max 50", async () => {
  const ids = (await getCandidateIds({})).slice(0, 60);
  const rows = await getListingsByIds(ids);
  assert.ok(rows.length <= 50);
  for (const r of rows) {
    assert.ok(ids.includes(String(r.L_ListingID)));
    assert.ok("remarks" in r);
  }
  assert.deepEqual(await getListingsByIds([]), []);
});

test("remarks pages walk the table in id order without repeats", async () => {
  const p1 = await getRemarksPage({ batch: 3 });
  assert.ok(p1.length <= 3);
  if (p1.length === 3) {
    const p2 = await getRemarksPage({ batch: 3, afterId: String(p1[2].L_ListingID) });
    for (const r of p2) assert.ok(!p1.some((x) => x.L_ListingID === r.L_ListingID));
  }
  for (const r of p1) assert.ok(r.remarks && r.remarks.length > 0);
});
