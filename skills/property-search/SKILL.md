---
name: property-search
description: Searches live California MLS listings (rets_property) and recent sold comps (california_sold) and replies with formatted property cards. Use whenever the user wants to find, see or browse homes, condos, townhomes or land, asks for "more" results, or asks what homes recently sold for in a city.
---

# Property Search (IDX Week 3)

Searches the local MLS database and returns ready-to-send WhatsApp property cards.
This replaces the Week 2 `property-query-parser` skill for search requests (it parses the text first, then queries).

## 1. Find listings

Pass the user's request exactly as written, in double quotes:

```bash
cd ~/idx-openclaw-assistant && npm run -s search -- "<user message>"
```

Options (add after the quoted text):
- `--page 2` for the next page when the user says "more" / "next". Reuse their previous search text.
- `--limit 5` cards per page (default 5, max 50).
- `--sort price_desc` (also `price_asc`, `newest`, `sqft_desc`) when they ask for most expensive, newest, biggest.
- `--comps` to add a 12-month sold-price summary for the city.

## 2. Recent sales (comps)

When the user asks what homes sold for, recent sales, or market prices in a city:

```bash
cd ~/idx-openclaw-assistant && npm run -s comps -- "<city>" --months 12 --limit 5
```

Optional: `--beds 3`, `--type Condominium`.

## How to reply

- Send the command output as-is. It's already formatted for WhatsApp (*bold*, emojis, one card per home).
- If it says "No active listings found", suggest one change: higher budget, fewer beds, or a nearby city.
- If the request has no city, ask which city before searching.
- Never make up listings, prices, addresses or agent details. Only send what the command returned.
- If the command prints "Can't reach the MLS database", tell the user search is temporarily down.
- Never run other SQL or dump the database. Max 50 rows per request.
