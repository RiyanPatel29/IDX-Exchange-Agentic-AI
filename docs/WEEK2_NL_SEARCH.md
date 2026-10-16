# Week 2: Natural Language Property Search

**Deliverable:** an OpenClaw skill that accepts a free-text query and returns a structured filter object, validated against at least 10 test queries.

**Status:** parser done, 17/17 tests passing, skill written.

## What it does

```
"Show me 3-bedroom condos in Irvine under $1.5M with a pool."
        │
        ▼  parsePropertyQuery()
{
  "city": "Irvine", "minPrice": null, "maxPrice": 1500000,
  "beds": 3, "baths": null, "sqft": null, "type": "Condominium",
  "pool": "True", "hasView": null, "maxHoa": null
}
        │
        ▼  Week 3: becomes  WHERE L_City = ? AND L_SystemPrice <= ? AND L_Keyword2 >= ? ...
```

## Files

| File | Purpose |
|---|---|
| `src/search/parsePropertyQuery.ts` | The parser |
| `src/search/cli.ts` | Command line wrapper the OpenClaw skill calls |
| `tests/parsePropertyQuery.test.ts` | 17 test queries (`npm test`) |
| `skills/property-query-parser/SKILL.md` | OpenClaw skill |
| `scripts/check_search_values.py` | Confirms the type/status/pool values match the real data |

## Filters supported

| User says | Filter | Column |
|---|---|---|
| "in Irvine", "near San Diego", "San Jose condos" | city | L_City |
| "under $1.5M", "up to 800k", "budget 1.1M" | maxPrice | L_SystemPrice |
| "over 3 million", "at least $500k" | minPrice | L_SystemPrice |
| "between 900k and 1.4M", "800-950k" | minPrice + maxPrice | L_SystemPrice |
| "3 bed", "3-bedroom", "3br", "4+ beds", "three bedroom" | beds (min) | L_Keyword2 |
| "2.5 bath", "2ba", "two bathroom" | baths (min) | LM_Dec_3 |
| "at least 1,800 sq ft" | sqft (min) | LM_Int2_3 |
| condo, townhome, house / single family, duplex, mobile home, land | type | L_Type_ |
| "with a pool" / "no pool" | pool "True"/"False" | PoolPrivateYN |
| "ocean view" / "without a view" | hasView "True"/"False" | ViewYN |
| "HOA under $400" / "no HOA" | maxHoa (0 = none) | AssociationFee |

## Improvements over the handbook's starter parser

- **Price range and minimum price.** The handbook's version only handled "under X".
- **HOA and sqft are pulled out first,** so "HOA under $400" isn't read as the home price.
- **"under 3"** is not treated as a price. It needs a `$`, a k/M suffix, or a number of 10,000 or more.
- **Number words** ("three bedroom"), shorthand ("3bd/2ba", "4+ beds") and "million" spelled out.
- **Negation:** "no pool", "without a view", "no HOA".
- **Cities without "in"** ("San Jose condos"), using a list of major CA cities. A known city also beats a bad guess ("in the hills of Malibu" gives Malibu).
- **City names in lowercase** are title-cased ("san diego" becomes "San Diego").

## Test results

```
    ok 1 - Show me 3-bedroom condos in Irvine under $1.5M with a pool.
    ok 2 - 2 bed townhomes in san diego under 800k
    ok 3 - 4 bed 2.5 bath single family home in Pasadena at least 1,800 sq ft
    ok 4 - houses in Los Angeles between $900k and $1.4M
    ok 5 - homes in Newport Beach over 3 million with an ocean view
    ok 6 - condo in Irvine under 1.2M with HOA under $400
    ok 7 - 3br house in Riverside no HOA no pool under 650k
    ok 8 - San Jose condos under $900,000
    ok 9 - three bedroom two bathroom house in Palm Desert with a pool
    ok 10 - 3bd/2ba in Long Beach up to $750k
    ok 11 - 4+ beds in Santa Monica under 2.5 million
    ok 12 - vacant land near Temecula under 300k
    ok 13 - looking for a home with mountain views in Pasadena, budget 1.1M
    ok 14 - homes in Irvine with at least 3 bedrooms
    ok 15 - house in the hills of Malibu
    ok 16 - homes priced 800-950k in Yorba Linda
    ok 17 - show me something nice
    # pass 17
    # fail 0
```

## Known limits (next steps)

- "under 2000 sqft" is read as a **minimum**. A max sqft filter would need its own field.
- The city list is hand-written. Week 3 can check names against `SELECT DISTINCT L_City`.
- Regex can't follow conversation context ("cheaper ones", "what about Tustin"). That's Week 4 (session memory).
- A fallback could ask the LLM to fill the same JSON when the regex finds nothing.

## How to run

```bash
cd ~/idx-openclaw-assistant
npm install
npm test
npm run parse -- "3 bed condos in Irvine under 1.5M with a pool"
python scripts/check_search_values.py
```
