---
name: idx-assistant
description: Main IDX real estate assistant with memory. Use for ANY message about finding homes, condos, townhomes or land in California, follow-ups on an earlier search ("more", "next", "only ones with a pool", "cheaper", "what about Tustin", "tell me about #2", "sort by newest", "start over"), descriptive requests ("quiet street with a big backyard", "modern kitchen near a park"), and market questions (prices, median, price per sqft, days on market, trends, recent sales, buyer's vs seller's market, comparing cities). Remembers each user's last search.
---

# IDX Assistant (Weeks 4-6: search with memory, market stats, description search)

Every property message goes through one command. It remembers the user's last search,
so follow-ups refine it instead of starting over. Replaces the `property-search` skill
for conversations (remove that one from the workspace so the agent doesn't pick the old one).

## Run

Pass the sender's WhatsApp number (or chat id) as `--user`, and the message exactly as written:

```bash
cd ~/idx-openclaw-assistant && npm run -s chat -- --user "<sender number>" "<user message>"
```

If you don't know the sender, use `--user me`. Always use the same id for the same person.

Pass follow-ups as-is. Do NOT rewrite "more" into a full query, the command already knows the last search.
Examples of what it understands:

- New search: "3 bed condos in Irvine under 1.5M"
- Paging: "more", "next", "back"
- Details: "tell me about #2", "the second one", "number 4"
- Refine: "only ones with a pool", "under 900k", "no HOA", "at least 2000 sqft"
- Relative: "cheaper", "bigger", "more bedrooms", "more expensive"
- New city, same filters: "what about Tustin", "try Lake Forest"
- Drop a filter: "any price", "pool doesn't matter", "any type"
- Sort: "sort by newest", "most expensive first", "biggest first"
- Reset: "start over", "new search"

Descriptive requests (Week 6) go through the same command too. Words like "quiet", "backyard",
"remodeled", "ocean view", "near a park" rank listings by their description (meaning, not just keywords):

- "quiet cul-de-sac home in Irvine under 2M with a big backyard"
- After any search: "only ones with a modern kitchen", "something walkable near restaurants"
- Results show a ✨ line quoting the part of the description that matched.

Market questions (Week 5) go through the same command:

- "how's the Irvine condo market?", "what are homes selling for in Tustin lately"
- "median price per sqft in San Diego last 3 months", "recent sales in Irvine"
- "is Tustin a buyer's market?", "compare Irvine vs Tustin vs Lake Forest"
- Follow-ups after a market answer: "what about Tustin", "compare it with Lake Forest", "last 3 months", "condos only"

## How to reply

- Send the output as-is. It's already formatted for WhatsApp.
- If the output is `NOT_A_PROPERTY_REQUEST`, answer the user yourself (greetings, general questions).
- If it asks "Which city should I search?" or "Which city's market...", send that. Their next message (just a city) goes back through the command.
- Never make up listings, prices, addresses or agent details.
- If it prints "Can't reach the MLS database", tell the user search is temporarily down.
- Never run other SQL or dump the database.
- Market numbers come only from closed sales in the database. Don't add your own price predictions or advice on top.
