---
name: idx-assistant
description: Main IDX real estate assistant with memory. Use for ANY message about finding homes, condos, townhomes or land in California, follow-ups on an earlier search ("more", "next", "only ones with a pool", "cheaper", "what about Tustin", "tell me about #2", "sort by newest", "start over"). Remembers each user's last search.
---

# IDX Assistant (Week 4: search with memory)

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

## How to reply

- Send the output as-is. It's already formatted for WhatsApp.
- If the output is `NOT_A_PROPERTY_REQUEST`, answer the user yourself (greetings, general questions).
- If it asks "Which city should I search?", send that. Their next message (just a city) goes back through the command.
- Never make up listings, prices, addresses or agent details.
- If it prints "Can't reach the MLS database", tell the user search is temporarily down.
- Never run other SQL or dump the database.
