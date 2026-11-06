// Week 4: full conversations with a fake database (no MySQL needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleMessage, humanizeChange, type Deps } from "../src/agent/handleMessage.ts";
import { MemorySessionStore, FileSessionStore, newSession } from "../src/session/sessionStore.ts";
import type { ListingRow, SearchResult } from "../src/db/listings.ts";

function row(id: number, city: string, price: number, extra: Partial<ListingRow> = {}): ListingRow {
  return {
    L_ListingID: String(id), L_DisplayId: `MLS${id}`, L_Address: `${id} Main St`, L_City: city, L_Zip: "92618",
    price, beds: 3, baths: 2, sqft: 1500, type: "Condominium", status: "Active", lat: null, lng: null,
    YearBuilt: 2010, AssociationFee: 300, DaysOnMarket: 5, PoolPrivateYN: "False", ViewYN: "False",
    FireplaceYN: "False", PhotoCount: 10, LA1_UserFirstName: "Ana", LA1_UserLastName: "Lee",
    LO1_OrganizationName: "Test Realty", ...extra,
  };
}

// 12 fake listings: Irvine 1-8, Tustin 9-12
const DB: ListingRow[] = [
  ...Array.from({ length: 8 }, (_, i) => row(i + 1, "Irvine", 800_000 + i * 100_000, { PoolPrivateYN: i % 2 ? "True" : "False" })),
  ...Array.from({ length: 4 }, (_, i) => row(i + 9, "Tustin", 700_000 + i * 100_000)),
];

function fakeDeps(store = new MemorySessionStore()) {
  const calls: any[] = [];
  const deps: Deps = {
    store,
    async search(f, opts) {
      calls.push({ f, opts });
      let rows = DB.filter((r) =>
        (!f.city || r.L_City === f.city) &&
        (f.maxPrice == null || Number(r.price) <= f.maxPrice) &&
        (!f.pool || r.PoolPrivateYN === f.pool));
      if (opts.sort === "price_desc") rows = [...rows].sort((a, b) => Number(b.price) - Number(a.price));
      const limit = opts.limit ?? 5, page = opts.page ?? 1;
      const r: SearchResult = {
        listings: rows.slice((page - 1) * limit, page * limit), total: rows.length,
        page, limit, totalPages: Math.max(1, Math.ceil(rows.length / limit)),
      };
      return r;
    },
    async getListing(id) {
      const r = DB.find((x) => x.L_ListingID === id);
      return r ? { ...r, remarks: `Lovely home number ${id}.` } : null;
    },
  };
  return { deps, calls };
}

test("a whole conversation: search, refine, more, details, new city, reset", async () => {
  const { deps, calls } = fakeDeps();
  const u = "+15550001111";

  let r = await handleMessage(u, "condos in Irvine", deps);
  assert.equal(r.intent, "search");
  assert.match(r.text!, /Found 8 active listings/);
  assert.match(r.text!, /Showing 1-5/);

  r = await handleMessage(u, "more", deps);
  assert.equal(r.intent, "page");
  assert.match(r.text!, /Showing 6-8/);
  assert.equal(calls.at(-1).opts.page, 2);

  r = await handleMessage(u, "tell me about #7", deps);
  assert.equal(r.intent, "details");
  assert.match(r.text!, /7 Main St/);
  assert.match(r.text!, /Lovely home number 7/);

  r = await handleMessage(u, "#2", deps); // only 6-8 are on screen now
  assert.match(r.text!, /only have #6-#8/);

  r = await handleMessage(u, "only ones with a pool", deps);
  assert.equal(r.intent, "refine");
  assert.match(r.text!, /Updated: with pool/);
  assert.deepEqual(calls.at(-1).f, { city: "Irvine", type: "Condominium", pool: "True" });
  assert.equal(calls.at(-1).opts.page, 1, "refining goes back to page 1");

  r = await handleMessage(u, "what about Tustin", deps);
  assert.equal(calls.at(-1).f.city, "Tustin");
  assert.equal(calls.at(-1).f.pool, "True", "kept the pool filter");

  r = await handleMessage(u, "start over", deps);
  assert.equal(r.intent, "reset");
  r = await handleMessage(u, "more", deps);
  assert.equal(r.intent, "none", "nothing to page after a reset");
});

test("users don't share sessions", async () => {
  const { deps } = fakeDeps();
  await handleMessage("alice", "condos in Irvine", deps);
  await handleMessage("bob", "condos in Tustin", deps);
  const a = await deps.store.get("alice");
  const b = await deps.store.get("bob");
  assert.equal(a.filters.city, "Irvine");
  assert.equal(b.filters.city, "Tustin");
});

test("asks for a city, then uses the answer", async () => {
  const { deps, calls } = fakeDeps();
  let r = await handleMessage("u", "show me condos under 1M", deps);
  assert.equal(r.intent, "need_city");
  assert.equal(calls.length, 0, "didn't search the whole state");
  r = await handleMessage("u", "Irvine", deps);
  assert.match(r.text!, /Found 3 active listings/);
  assert.deepEqual(calls[0].f, { city: "Irvine", maxPrice: 1_000_000, type: "Condominium" });
});

test("paging past the end says so", async () => {
  const { deps } = fakeDeps();
  await handleMessage("u", "condos in Tustin", deps); // 4 results, 1 page
  const r = await handleMessage("u", "more", deps);
  assert.match(r.text!, /That's everything/);
});

test("non-property messages return null so the agent answers itself", async () => {
  const { deps } = fakeDeps();
  const r = await handleMessage("u", "what's the weather like?", deps);
  assert.equal(r.text, null);
});

test("sessions expire after the TTL", async () => {
  const store = new MemorySessionStore(0); // 0 minutes = expires right away
  const { deps } = fakeDeps(store);
  await handleMessage("u", "condos in Irvine", deps);
  await new Promise((res) => setTimeout(res, 5));
  const s = await store.get("u");
  assert.deepEqual(s.filters, {});
});

test("file store round-trips and never uses the phone number as a file name", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "idx-sess-"));
  try {
    const store = new FileSessionStore(dir, 60);
    const s = newSession("+15551234567");
    s.filters = { city: "Irvine" };
    await store.save(s);
    const back = await store.get("+15551234567");
    assert.equal(back.filters.city, "Irvine");
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    assert.ok(!files[0].includes("5551234567"));
    await store.clear("+15551234567");
    assert.deepEqual((await store.get("+15551234567")).filters, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("humanizeChange", () => {
  assert.equal(humanizeChange("maxPrice → 900000"), "max price $900,000");
  assert.equal(humanizeChange("pool → True"), "with pool");
  assert.equal(humanizeChange("removed maxPrice"), "no max price filter");
  assert.equal(humanizeChange("type → SingleFamilyResidence"), "Single Family Residence");
  assert.equal(humanizeChange("sort → price_desc"), "sorted by highest price");
});
