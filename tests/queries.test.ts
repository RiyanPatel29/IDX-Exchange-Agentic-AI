// Week 3: SQL builder tests (no database needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildListingQuery, buildCompsQuery, MAX_LIMIT } from "../src/db/queries.ts";
import { parsePropertyQuery, activeFilters } from "../src/search/parsePropertyQuery.ts";
import { formatListingCard, formatSearchResult, describeFilters } from "../src/db/format.ts";

test("Week 2 filters become parameterized WHERE clauses", () => {
  const f = activeFilters(parsePropertyQuery("3 bed condos in Irvine under $1.5M with a pool"));
  const q = buildListingQuery(f);
  assert.match(q.sql, /L_City = \?/);
  assert.match(q.sql, /L_SystemPrice <= \?/);
  assert.match(q.sql, /L_Keyword2 >= \?/);
  assert.match(q.sql, /L_Type_ = \?/);
  assert.match(q.sql, /PoolPrivateYN = \?/);
  assert.deepEqual(q.params, ["Active", "Active", "Irvine", 1_500_000, 3, "Condominium", "True"]);
});

test("user text never ends up inside the SQL (SQL injection)", () => {
  const evil = "Irvine'; DROP TABLE rets_property; --";
  const q = buildListingQuery({ city: evil });
  assert.ok(!q.sql.includes("DROP TABLE"));
  assert.ok(q.params.includes(evil));
});

test("limit is capped at 50 and page is at least 1", () => {
  const q = buildListingQuery({}, { limit: 10_000, page: -3 });
  assert.equal(q.limit, MAX_LIMIT);
  assert.equal(q.page, 1);
  assert.match(q.sql, /LIMIT 50 OFFSET 0/);
});

test("pagination offset", () => {
  const q = buildListingQuery({}, { limit: 10, page: 3 });
  assert.match(q.sql, /LIMIT 10 OFFSET 20/);
});

test("garbage limit/page/sort fall back to safe defaults", () => {
  const q = buildListingQuery({}, { limit: "abc" as any, page: "1; DROP" as any, sort: "1; DROP" as any });
  assert.match(q.sql, /LIMIT 10 OFFSET 0/);
  assert.match(q.sql, /ORDER BY L_SystemPrice ASC/);
  assert.ok(!q.sql.includes("DROP"));
});

test("count query uses the same filters", () => {
  const q = buildListingQuery({ city: "Irvine", beds: 2 });
  assert.match(q.countSql, /COUNT\(\*\)/);
  assert.deepEqual(q.countParams, q.params);
});

test("no HOA matches blank or zero fees, without a param", () => {
  const q = buildListingQuery({ maxHoa: 0 });
  assert.match(q.sql, /AssociationFee IS NULL OR AssociationFee = 0/);
  assert.deepEqual(q.params, ["Active", "Active"]);
});

test("comps query converts the VARCHAR CloseDate and drops future dates", () => {
  const q = buildCompsQuery("Irvine", { months: 6, beds: 3 });
  assert.match(q.sql, /STR_TO_DATE\(NULLIF\(CloseDate, ''\), '%Y-%m-%d'\) <= CURDATE\(\)/);
  assert.match(q.sql, /INTERVAL 6 MONTH/);
  assert.match(q.sql, /PropertyType = 'Residential'/);
  assert.deepEqual(q.params, ["Irvine", 3]);
});

const SAMPLE = {
  L_ListingID: "1", L_DisplayId: "OC1", L_Address: "1 Test Ln", L_City: "Irvine", L_Zip: "92618",
  price: 1150000, beds: 3, baths: 2, sqft: 1450, type: "SingleFamilyResidence", status: "Active",
  lat: null, lng: null, YearBuilt: 2015, AssociationFee: 420, DaysOnMarket: 12,
  PoolPrivateYN: "True", ViewYN: "False", FireplaceYN: "False", PhotoCount: 18,
  LA1_UserFirstName: null, LA1_UserLastName: null, LO1_OrganizationName: null,
};

test("property card shows address, price, beds/baths, sqft, photos", () => {
  const card = formatListingCard(SAMPLE, 1);
  assert.match(card, /1\. 🏠 \*1 Test Ln, Irvine 92618\*/);
  assert.match(card, /\$1,150,000/);
  assert.match(card, /3 bd \/ 2 ba/);
  assert.match(card, /1,450 sqft/);
  assert.match(card, /Single Family Residence/);
  assert.match(card, /18 photos/);
  assert.match(card, /Pool/);
});

test("result header, paging hint and empty message", () => {
  const out = formatSearchResult({ listings: [SAMPLE], total: 12, page: 1, limit: 5, totalPages: 3 }, { city: "Irvine" });
  assert.match(out, /Found 12 active listings \(in Irvine\)\. Showing 1-1/);
  assert.match(out, /Reply "more" for page 2 of 3/);
  const none = formatSearchResult({ listings: [], total: 0, page: 1, limit: 5, totalPages: 1 }, { city: "Atlantis" });
  assert.match(none, /No active listings found/);
});

test("describeFilters reads like plain English", () => {
  assert.equal(describeFilters({ type: "Condominium", city: "Irvine", beds: 3, maxPrice: 1500000, pool: "True" }),
    "Condominium, in Irvine, 3+ bd, under $1,500,000, with pool");
});
