# Week 5: Market Stats

**Goal:** answer market questions from `california_sold` (closed sales) and `rets_property` (active inventory).

## What you can ask

```
how's the Irvine condo market?
what are homes selling for in Tustin lately
median price per sqft in San Diego last 3 months
recent sales in Irvine
is Tustin a buyer's market?
compare Irvine vs Tustin vs Lake Forest
```

Follow-ups right after a market answer: "what about Tustin", "compare it with Lake Forest", "last 3 months", "condos only".
"How's the market there?" after a listing search uses the city and type you were just searching.

## What a report shows

| Stat | How it's computed |
|---|---|
| Closed sales | `COUNT(*)` of residential sales in the window |
| Median / avg sale price | median via `ROW_NUMBER() OVER` (MySQL has no MEDIAN) |
| Median $/sqft | `ClosePrice / LivingArea`, only when living area is 200-50,000 sqft |
| Median days on market | `DaysOnMarket` |
| Sale-to-list % | avg `ClosePrice / ListPrice` |
| % over asking | share of sales with `ClosePrice > ListPrice` |
| Active inventory | active listings in `rets_property` for the same city/type/beds |
| Months of supply | active listings ÷ closed sales per month |
| Market temperature | < 3 months supply = seller's, 3-6 = balanced, > 6 = buyer's |
| Monthly trend | median price per month + sparkline (▁▂▃▅▇), % change first to last full month |
| Busiest ZIPs | top 5 ZIPs by sales with avg price and $/sqft |

Example output (fake fixture data):

```
📊 *Tustin home market, last 12 months*
5 closed sales (Jun 6, 2026 to Oct 6, 2026)

💰 Median sale $900,000 (avg $1,180,000)
📏 Median $900/sqft
⏱ Median 30 days on market
🏷 Sold at 100.2% of list price on average · 40% went over asking
🏘 2 active listings now, median list $922,000 · 5 months of supply
➡️ Balanced market ⚖️
📈 Median price by month: █▂▂▁▁
```

## Data cleaning rules

- `PropertyType = 'Residential'` only (drops leases like a $4,200/mo rental "sale").
- `CloseDate` is a VARCHAR, converted with `STR_TO_DATE`; future dates (the 2072 typos) are dropped.
- `ClosePrice` between $10K and $100M (drops $1 typos).
- Medians, not just averages, because one $20M sale moves an average a lot.
- **The export only starts in March 2026.** A "12 month" window really covers ~8 months. Months of supply uses the real covered span, and the report adds a note when the window is longer than the data.

## Files

- `src/market/marketQueries.ts`: parameterized SQL (summary, monthly trend, ZIPs, active inventory). City or 5-digit ZIP.
- `src/market/marketStats.ts`: runs the queries, works out months of supply, temperature and trend.
- `src/market/formatMarket.ts`: WhatsApp text, sparkline, city comparison with "best value / fastest / strongest offers".
- `src/market/parseMarketQuery.ts`: spots market questions, pulls out cities, time window, type, beds.
- `src/agent/marketIntent.ts`: routing for market questions and market follow-ups.
- `src/market/marketCli.ts`: `npm run market`.

## Run it

```bash
npm test                     # unit tests incl. Week 5
npm run test:db              # Week 5 DB tests (exact-number checks only run on the fake fixture)
npm run -s market -- Irvine
npm run -s market -- Irvine --months 6 --type Condominium --beds 2
npm run -s market -- 92618
npm run -s market -- --compare "Irvine,Tustin,Lake Forest"
npm run -s market -- "how's the Tustin condo market lately?"
npm run -s chat -- --user me "compare Irvine vs Tustin"
```

## Known limits

- No year-over-year yet: the sales data only goes back to March 2026.
- `PropertySubType` (sold) and `L_Type_` (active) are assumed to use the same values (Condominium, SingleFamilyResidence...). Worth checking on the real data with `scripts/check_search_values.py`.
- Months-of-supply thresholds are a common rule of thumb, not an official IDX definition.
