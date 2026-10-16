// Week 2 deliverable: validate the parser against 10+ test queries.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePropertyQuery, type PropertyFilters } from "../src/search/parsePropertyQuery.ts";

const EMPTY: PropertyFilters = {
  city: null, minPrice: null, maxPrice: null, beds: null, baths: null,
  sqft: null, type: null, pool: null, hasView: null, maxHoa: null,
};

// [query, expected filters (anything not listed must be null)]
const CASES: [string, Partial<PropertyFilters>][] = [
  // 1. Handbook example
  ["Show me 3-bedroom condos in Irvine under $1.5M with a pool.",
    { city: "Irvine", maxPrice: 1_500_000, beds: 3, type: "Condominium", pool: "True" }],
  // 2. Lowercase city, k suffix
  ["2 bed townhomes in san diego under 800k",
    { city: "San Diego", maxPrice: 800_000, beds: 2, type: "Townhouse" }],
  // 3. Beds + baths with half bath, sqft with comma
  ["4 bed 2.5 bath single family home in Pasadena at least 1,800 sq ft",
    { city: "Pasadena", beds: 4, baths: 2.5, sqft: 1800, type: "SingleFamilyResidence" }],
  // 4. Price range
  ["houses in Los Angeles between $900k and $1.4M",
    { city: "Los Angeles", minPrice: 900_000, maxPrice: 1_400_000, type: "SingleFamilyResidence" }],
  // 5. Min price + view
  ["homes in Newport Beach over 3 million with an ocean view",
    { city: "Newport Beach", minPrice: 3_000_000, hasView: "True" }],
  // 6. HOA limit must not be read as the price
  ["condo in Irvine under 1.2M with HOA under $400",
    { city: "Irvine", maxPrice: 1_200_000, type: "Condominium", maxHoa: 400 }],
  // 7. No HOA, no pool
  ["3br house in Riverside no HOA no pool under 650k",
    { city: "Riverside", maxPrice: 650_000, beds: 3, type: "SingleFamilyResidence", maxHoa: 0, pool: "False" }],
  // 8. City without "in" (known-city fallback)
  ["San Jose condos under $900,000",
    { city: "San Jose", maxPrice: 900_000, type: "Condominium" }],
  // 9. Number words
  ["three bedroom two bathroom house in Palm Desert with a pool",
    { city: "Palm Desert", beds: 3, baths: 2, type: "SingleFamilyResidence", pool: "True" }],
  // 10. Shorthand bd/ba and "up to"
  ["3bd/2ba in Long Beach up to $750k",
    { city: "Long Beach", beds: 3, baths: 2, maxPrice: 750_000 }],
  // 11. "4+ beds" and "million" spelled out
  ["4+ beds in Santa Monica under 2.5 million",
    { city: "Santa Monica", beds: 4, maxPrice: 2_500_000 }],
  // 12. Land
  ["vacant land near Temecula under 300k",
    { city: "Temecula", maxPrice: 300_000, type: "UnimprovedLand" }],
  // 13. Budget phrasing + mountain view
  ["looking for a home with mountain views in Pasadena, budget 1.1M",
    { city: "Pasadena", maxPrice: 1_100_000, hasView: "True" }],
  // 14. Nothing price-like: "under 3" should not become a price
  ["homes in Irvine with at least 3 bedrooms",
    { city: "Irvine", beds: 3 }],
  // 15. Known city beats the "in ..." guess
  ["house in the hills of Malibu",
    { city: "Malibu", type: "SingleFamilyResidence" }],
  // 16. Range with one suffix, city not in the known list
  ["homes priced 800-950k in Yorba Linda",
    { city: "Yorba Linda", minPrice: 800_000, maxPrice: 950_000 }],
  // 17. Empty-ish query
  ["show me something nice",
    {}],
];

for (const [query, expected] of CASES) {
  test(query, () => {
    assert.deepEqual(parsePropertyQuery(query), { ...EMPTY, ...expected });
  });
}
