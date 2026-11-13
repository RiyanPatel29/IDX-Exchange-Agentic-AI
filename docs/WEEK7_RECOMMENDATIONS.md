# Week 7: Recommendation Engine

**Goal:** go from "here are homes that match" to "here are the best ones for you, and why", using both tables.

## What you can say

```
recommend 3 bed condos in Irvine under 1.5M
best deals in Tustin
what do you recommend?            (uses the search you were just doing)
homes like #2                     (or "more like this" after "tell me about #2")
I like #2 / #3 looks great        (saves it, tunes future picks)
not #4 / hide #1                  (removes it, steers away from homes like it)
my favorites / clear my likes
```

Follow-ups from Week 4 still work on picks: "more", "tell me about #3", "only ones with a pool", "cheaper", "what about Tustin". Asking for a sort ("cheapest first") goes back to a plain search.

## How a home is scored (out of 100)

| Part | Points | How |
|---|---|---|
| Fit | 40 | Budget, beds, baths, size, pool, view, HOA. The pool is pulled with some slack (up to 10% over budget, one bed short, 10% smaller) so near-misses show up with a ⚠️ instead of vanishing. Pool/view are "nice to have", not filters. For "homes like #2", fit = similarity to that home. |
| Value | 35 | The home's $/sqft vs. the **median $/sqft of recent sales of the same type** in its ZIP (`california_sold`, last 12 months, at least 3 sales). Falls back to the city median for that type (at least 5 sales). 10% below the median = full marks. Never compares a condo to house prices. |
| Freshness | 10 | New listings score higher. Over 90 days on market gets a "may be room to negotiate" note. |
| Taste | 15 | Similarity to homes the user liked, minus similarity to ones they passed on. Neutral (7.5) until they like something. |

Similarity (used for "homes like #2" and taste) compares ZIP/city, type, price (within 30%), beds, size, pool and year built.

The top 5 can't all come from one ZIP (max 3) when other good options exist.

Each pick shows its score and up to 3 reasons, best first, for example:

```
⭐ Match 88/100
• 💲 9% below 92618 condos ($793 vs $875/sqft, 4 recent sales)
• $150,000 under your budget
• 📜 Last sold $1,100,000 in May 2026 (now +14%)
```

The last line uses the handbook join key: `CAST(r.L_ListingID AS UNSIGNED) = cs.ListingKey`.

## How it works

```mermaid
flowchart LR
    M[message] --> I{recommend / like #2 /<br/>homes like #2?}
    I --> P[(rets_property<br/>candidate pool ≤ 200,<br/>relaxed filters)]
    P --> B[(california_sold<br/>same-type $/sqft medians<br/>by ZIP + city)]
    P & B --> S[score: fit + value +<br/>freshness + taste]
    L[session: liked / disliked] --> S
    S --> R[rank, drop dislikes,<br/>ZIP variety]
    R --> H[(california_sold<br/>sold history for top 5<br/>ListingKey join)]
    H --> W[WhatsApp cards<br/>score + reasons]
    R --> SV[session: top 50 ids<br/>for "more"]
```

## Files

- `src/recommend/recQueries.ts`: candidate pool, $/sqft benchmarks (window-function medians), sold history, "similar" filters. All parameterized.
- `src/recommend/score.ts`: fit, value, freshness, taste, similarity, ranking. Pure functions.
- `src/recommend/recommend.ts`: the engine + live MySQL deps.
- `src/recommend/recIntent.ts`: spots "recommend", "homes like #2", "I like #2", "not #3", "my favorites".
- `src/recommend/formatRec.ts`: WhatsApp cards with ⭐ score and reasons.
- `src/recommend/recommendCli.ts`: `npm run recommend`.
- `src/agent/handleMessage.ts`: routing, paging through picks, likes/dislikes.
- `src/session/sessionStore.ts`: new fields `liked`, `disliked`, `recRanked`, `recAnchor`, `lastDetailId`. **Likes are kept when the 2-hour session expires**; the search isn't.

## Run it

```bash
npm test                          # unit tests incl. Week 7
npm run test:db                   # DB tests (exact numbers only on the fake fixture)
npm run -s recommend -- "best deals in Irvine under 1.5M"
npm run -s recommend -- "3 bed condos in Irvine" --json      # see the score breakdown
npm run -s recommend -- --similar <L_ListingID>
npm run -s chat -- --user me "recommend condos in Irvine under 1.3M"
npm run -s chat -- --user me "I like #1"
npm run -s chat -- --user me "recommend"
cp -r skills/idx-assistant ~/.openclaw/workspace/skills/ && openclaw gateway restart
```

## Safety

- Candidate pool (max 200) and benchmarks are internal for scoring; users see 5 per page, at most 50 ranked picks.
- Benchmarks return medians per group only, never individual sales.
- Sold-history lookup takes numeric ids only, max 50.

## Known limits / next steps

- Sales data only starts March 2026, so ZIP medians can be thin; the card says how many sales each benchmark uses, and there's no value score when there aren't enough.
- `PropertySubType` (sold) and `L_Type_` (active) are assumed to use the same values. Check on real data.
- Scoring weights are hand-picked, not learned. Worth tuning with the mentor on real listings.
- Recommendations don't use the Week 6 description embeddings yet ("recommend quiet homes" ranks on numbers only).
