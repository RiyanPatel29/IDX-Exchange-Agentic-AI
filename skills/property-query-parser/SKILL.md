---
name: property-query-parser
description: Turns a free-text California home search (city, budget, beds, baths, sqft, property type, pool, view, HOA) into a structured filter object for the rets_property table. Use whenever the user asks to find, search or show homes, condos, townhomes or land.
---

# Property Query Parser (IDX Week 2)

Converts a natural language home search into filters that map to `rets_property` columns.

## When to use

The user asks for listings, for example:
- "Show me 3-bedroom condos in Irvine under $1.5M with a pool"
- "houses in LA between 900k and 1.4M"
- "4 bed 2.5 bath in Pasadena, at least 1,800 sq ft, no HOA"

## How to run it

Run this command, passing the user's message exactly as written (in double quotes):

```bash
cd ~/idx-openclaw-assistant && npx tsx src/search/cli.ts "<user message>"
```

It prints JSON with `filters` (every field, null if not mentioned) and `active` (only the ones found).

## Filter fields

| Field | Column | Meaning |
|---|---|---|
| city | L_City | City name |
| minPrice / maxPrice | L_SystemPrice | Price range in dollars |
| beds | L_Keyword2 | Minimum bedrooms |
| baths | LM_Dec_3 | Minimum bathrooms (2.5 allowed) |
| sqft | LM_Int2_3 | Minimum square feet |
| type | L_Type_ | SingleFamilyResidence, Condominium, Townhouse, Duplex, ManufacturedHome, UnimprovedLand |
| pool | PoolPrivateYN | "True" / "False" |
| hasView | ViewYN | "True" / "False" |
| maxHoa | AssociationFee | Max monthly HOA, 0 = no HOA |

## How to reply (Week 2)

Database search arrives in Week 3. For now, reply on WhatsApp with a short summary of what you understood, then ask about anything important that is missing (usually city or budget). Example:

> Got it: 🏠 Condo in **Irvine**, 3+ beds, under **$1,500,000**, with a pool.
> Anything else, like a max HOA or minimum square feet?

Rules:
- Keep it short and plain.
- Don't invent listings, prices or addresses.
- If `active` is empty, ask which city and budget they have in mind.
