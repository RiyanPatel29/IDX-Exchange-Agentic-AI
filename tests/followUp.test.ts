// Week 4: follow-up understanding (no database needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  interpretFollowUp, parseDetailsIndex, parseSort, cityFromFollowUp, bareCity, diffFilters,
} from "../src/session/followUp.ts";
import { newSession, type SessionState } from "../src/session/sessionStore.ts";

// A session that already searched "3 bed condos in Irvine under 1.5M" and showed cards 1-5
function searched(extra: Partial<SessionState> = {}): SessionState {
  return {
    ...newSession("u1"),
    lastIntent: "search",
    filters: { city: "Irvine", type: "Condominium", beds: 3, maxPrice: 1_500_000 },
    page: 1, totalPages: 4, lastResultIds: ["a", "b", "c", "d", "e"], lastResultStart: 1,
    shown: { minPrice: 900_000, maxPrice: 1_400_000, medianSqft: 1500 },
    ...extra,
  };
}

test("first message is a new search", () => {
  const a = interpretFollowUp("3 bed condos in Irvine under 1.5M", newSession("u1"));
  assert.equal(a.kind, "search");
  if (a.kind === "search") {
    assert.equal(a.refined, false);
    assert.equal(a.filters.city, "Irvine");
  }
});

test("small talk with no session is not a search", () => {
  assert.equal(interpretFollowUp("hi there", newSession("u1")).kind, "none");
  assert.equal(interpretFollowUp("thanks!", searched()).kind, "none");
});

test("more / next / back page through results", () => {
  for (const t of ["more", "next", "Show more", "more please", "next page"]) {
    assert.deepEqual(interpretFollowUp(t, searched({ page: 2 })), { kind: "page", page: 3 }, t);
  }
  assert.deepEqual(interpretFollowUp("back", searched({ page: 2 })), { kind: "page", page: 1 });
  assert.deepEqual(interpretFollowUp("back", searched({ page: 1 })), { kind: "page", page: 1 });
});

test("'more' with no earlier search is not paging", () => {
  assert.notEqual(interpretFollowUp("more", newSession("u1")).kind, "page");
});

test("'more bedrooms' / 'more expensive' are refinements, not paging", () => {
  const a = interpretFollowUp("more bedrooms", searched());
  assert.equal(a.kind, "search");
  if (a.kind === "search") assert.equal(a.filters.beds, 4);
  const b = interpretFollowUp("more expensive", searched());
  assert.equal(b.kind, "search");
  if (b.kind === "search") assert.equal(b.filters.maxPrice, 1_875_000);
});

test("details index from many phrasings", () => {
  assert.equal(parseDetailsIndex("tell me about #2"), 2);
  assert.equal(parseDetailsIndex("number 3 please"), 3);
  assert.equal(parseDetailsIndex("the second one"), 2);
  assert.equal(parseDetailsIndex("the 4th one"), 4);
  assert.equal(parseDetailsIndex("more info on listing 5"), 5);
  assert.equal(parseDetailsIndex("tell me about 1"), 1);
  assert.equal(parseDetailsIndex("3 bed condos"), null);
  assert.equal(parseDetailsIndex("under 900k"), null);
});

test("details needs something on screen", () => {
  assert.deepEqual(interpretFollowUp("tell me about #2", searched()), { kind: "details", index: 2 });
});

test("refine keeps old filters and adds new ones", () => {
  const a = interpretFollowUp("only ones with a pool", searched());
  assert.equal(a.kind, "search");
  if (a.kind === "search") {
    assert.equal(a.refined, true);
    assert.deepEqual(a.filters, { city: "Irvine", type: "Condominium", beds: 3, maxPrice: 1_500_000, pool: "True" });
    assert.deepEqual(a.changes, ["pool → True"]);
  }
});

test("new budget replaces the old one", () => {
  const a = interpretFollowUp("under 900k", searched());
  assert.equal(a.kind, "search");
  if (a.kind === "search") assert.equal(a.filters.maxPrice, 900_000);
});

test("what about <city> swaps the city, known or not", () => {
  const a = interpretFollowUp("what about Tustin?", searched());
  assert.ok(a.kind === "search" && a.filters.city === "Tustin" && a.filters.beds === 3);
  const b = interpretFollowUp("how about Yorba Linda", searched());
  assert.ok(b.kind === "search" && b.filters.city === "Yorba Linda");
  assert.equal(cityFromFollowUp("what about cheaper ones"), null);
  assert.equal(cityFromFollowUp("what about condos"), null);
});

test("cheaper lowers the max 15% (rounded to $5k)", () => {
  const a = interpretFollowUp("cheaper ones", searched());
  assert.ok(a.kind === "search" && a.filters.maxPrice === 1_275_000);
  // no max yet: 15% under the most expensive one shown
  const b = interpretFollowUp("anything cheaper?", searched({ filters: { city: "Irvine" } }));
  assert.ok(b.kind === "search" && b.filters.maxPrice === 1_190_000);
});

test("bigger raises min sqft 20% over what was shown", () => {
  const a = interpretFollowUp("bigger", searched());
  assert.ok(a.kind === "search" && a.filters.sqft === 1800);
});

test("dropping filters", () => {
  const a = interpretFollowUp("any price is fine", searched());
  assert.ok(a.kind === "search" && a.filters.maxPrice === undefined);
  const b = interpretFollowUp("pool doesn't matter", searched({ filters: { city: "Irvine", pool: "True" } }));
  assert.ok(b.kind === "search" && b.filters.pool === undefined);
  const c = interpretFollowUp("any type", searched());
  assert.ok(c.kind === "search" && c.filters.type === undefined);
});

test("a full new request starts over instead of merging", () => {
  const a = interpretFollowUp("2 bed townhouses in San Diego under 900k", searched());
  assert.ok(a.kind === "search" && a.refined === false);
  if (a.kind === "search") assert.deepEqual(a.filters, { city: "San Diego", maxPrice: 900_000, beds: 2, type: "Townhouse" });
});

test("...unless it starts like a tweak", () => {
  const a = interpretFollowUp("what about 4 bed houses in Irvine", searched());
  assert.ok(a.kind === "search" && a.refined === true && a.filters.maxPrice === 1_500_000);
});

test("sorting", () => {
  assert.equal(parseSort("sort by newest"), "newest");
  assert.equal(parseSort("show me the most expensive first"), "price_desc");
  assert.equal(parseSort("cheapest first"), "price_asc");
  assert.equal(parseSort("biggest pool"), null);
  const a = interpretFollowUp("sort by newest", searched());
  assert.ok(a.kind === "search" && a.sort === "newest" && a.filters.city === "Irvine");
});

test("reset", () => {
  for (const t of ["start over", "new search", "reset", "clear filters"]) {
    assert.equal(interpretFollowUp(t, searched()).kind, "reset", t);
  }
});

test("after 'Which city?', a bare city name fills it in", () => {
  const s = searched({ lastIntent: "need_city", filters: { type: "Townhouse" }, lastResultIds: [], totalPages: 0 });
  const a = interpretFollowUp("Yorba Linda", s);
  assert.ok(a.kind === "search" && a.filters.city === "Yorba Linda" && a.filters.type === "Townhouse");
  assert.equal(bareCity("with a pool"), null);
});

test("diffFilters", () => {
  assert.deepEqual(diffFilters({ city: "Irvine", pool: "True" }, { city: "Tustin" }), ["city → Tustin", "removed pool"]);
});
