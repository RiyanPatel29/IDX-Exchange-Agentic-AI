# Week 3: MLS Database Integration

**Deliverable:** a working OpenClaw skill that takes the NLP filters from Week 2, queries `rets_property` and/or `california_sold`, and returns formatted property cards.

**Status:** done. 28 unit tests and 6 database tests passing.

## How it works

```
"3 bed condos in Irvine under 1.5M"
   │ Week 2: parsePropertyQuery()
   ▼
{ city: "Irvine", beds: 3, type: "Condominium", maxPrice: 1500000 }
   │ Week 3: buildListingQuery()  → SQL with ? placeholders + params array
   ▼
SELECT ... FROM rets_property
WHERE (L_Status = ? OR StandardStatus = ?) AND L_City = ? AND L_SystemPrice <= ?
  AND L_Keyword2 >= ? AND L_Type_ = ?
ORDER BY L_SystemPrice ASC LIMIT 5 OFFSET 0
   │ mysql2 pool (settings from .env)
   ▼
formatSearchResult()  → WhatsApp property cards
```

## Example output

```
Found 2 active listings (Condominium, in Irvine, 3+ bd, under $1,500,000). Showing 1-2:

1. 🏠 *1 Test Ln, Irvine 92618*
💰 $1,150,000 | 🛏 3 bd / 2 ba | 📐 1,450 sqft
🏷 Condominium · Built 2015 · HOA $420/mo · Pool
📅 12 days on market · 📷 18 photos · MLS# OC1001
```
(From the fake test database in `tests/fixtures/sample_db.sql`.)

## Files

| File | Purpose |
|---|---|
| `src/db/pool.ts` | mysql2 connection pool, `query()` helper |
| `src/db/queries.ts` | SQL builders: listings (filters, sort, pagination), comps, comps summary |
| `src/db/listings.ts` | `searchActiveListings()`, `getSoldComps()`, `getCompsSummary()` |
| `src/db/format.ts` | Property cards, comp cards, result header and paging |
| `src/search/searchCli.ts` | `npm run search -- "..."` |
| `src/search/compsCli.ts` | `npm run comps -- "City"` |
| `skills/property-search/SKILL.md` | OpenClaw skill |
| `tests/queries.test.ts` | SQL builder + formatting tests (no DB needed) |
| `tests/db/search.test.ts` | Real queries against MySQL |
| `tests/fixtures/sample_db.sql` | Fake rows for testing without the MLS data |

## Safety and correctness

- **Parameterized SQL.** User values only go into `params`. A test feeds in `Irvine'; DROP TABLE ...` and confirms it never reaches the SQL text.
- **Whitelisted sorting.** Users pick `price_asc`, `newest` and so on. Raw ORDER BY text is never accepted.
- **50-row cap.** `limit` is clamped to 1 to 50 and `page` to 1 or more (handbook safety rule).
- **Pagination** returns a total count, so the reply can say "Showing 1-5 of 132, reply more for page 2".
- **Comps clean-up.** `CloseDate` is a VARCHAR, so it goes through `STR_TO_DATE`. Blank dates, future typo dates (like 2072), $0 sales and leases are excluded.
- **"No HOA"** matches both blank and $0 fees.
- **Friendly errors.** If MySQL is down, the reply says so instead of dumping a stack trace.

## How to run

```bash
cd ~/idx-openclaw-assistant
npm install
npm test                      # 28 unit tests, no DB needed
npm run test:db               # 6 tests against your MySQL (uses .env)
npm run search -- "3 bed condos in Irvine under 1.5M"
npm run search -- "homes in San Diego" --sort newest --comps
npm run search -- "condos in Irvine" --page 2
npm run comps -- Irvine --months 6
```

Install the skill:

```bash
cp -r skills/property-search ~/.openclaw/workspace/skills/
```

Then ask on WhatsApp: *"3 bed condos in Irvine under 1.5M"*.

## Next (Week 4)

Multi-turn memory: remember the last search per user, so "more", "only ones with a pool" or "what about Tustin" refine it instead of starting over.
