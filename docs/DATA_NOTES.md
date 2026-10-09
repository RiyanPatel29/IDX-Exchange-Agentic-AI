# MLS Data Notes

Field-usage notes on the imported dumps. Feeds the capstone "schema annotation document".

## Snapshot (imported Oct 2026, database `idx_exchange`)

| Table | Rows | Columns | What it is |
|---|---|---|---|
| `rets_property` | 55,212 | 126 | Active CA listings (IDX legacy column names like `L_City`, `L_SystemPrice`) |
| `california_sold` | 98,552 | 46 | Sold/closed transactions (RESO-standard names like `ClosePrice`, `CloseDate`) |
| `rets_openhouse` | (optional) | | Open house schedule, shipped with the dumps, not in the handbook |

Top cities in `rets_property`: Los Angeles 4,015 · San Diego 2,198 · San Jose 1,047 · Irvine 723 · Palm Desert 598.

## Things to watch

- **Row counts are smaller than the handbook's "667,000+ records".** This export is likely a newer or trimmed snapshot. Confirm with mentor.
- **`california_sold.CloseDate` is a VARCHAR**, not a DATE. Always wrap it: `STR_TO_DATE(CloseDate, '%Y-%m-%d')`.
- **Close dates run 2026-03-18 to 2072-06-29.** The handbook says 2021-2025, so this export covers a more recent window, and 2072 is a data-entry typo. Market stats (Week 5) should filter `CloseDate <= CURDATE()`.
- **Database name:** the handbook mentions both `idx_exchange` (setup) and `boxgra5_cali` (schema). The dumps contain no `USE`/`CREATE DATABASE`, so they import into whatever DB you pick. We use `idx_exchange`.
- **Join key:** `CAST(rets_property.L_ListingID AS UNSIGNED) = california_sold.ListingKey`, or match on city + ZIP for market-level analysis.
