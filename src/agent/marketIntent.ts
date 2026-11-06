// Week 5: decide whether a message is a market question (incl. follow-ups) and with what settings.
// Pure function so it's unit tested without a database.
import { isMarketQuestion, parseMarketQuery } from "../market/parseMarketQuery.ts";
import { cityFromFollowUp, bareCity } from "../session/followUp.ts";
import { parsePropertyQuery } from "../search/parsePropertyQuery.ts";
import type { SessionState } from "../session/sessionStore.ts";

export type MarketPlan =
  | { kind: "market"; cities: string[]; months: number; type: string | null; beds: number | null; wantsRecentSales: boolean }
  | { kind: "need_market_city"; months: number; type: string | null; beds: number | null };

const SEARCH_VERBS = /\b(show|find|search|list|looking\s+for|look\s+for|for\s+sale|listings?|available)\b/i;
const HAS_WINDOW = /\b(last|past|this|lately|recently|ytd|year\s+to\s+date)\b/i;
const ADD_TO_COMPARE = /^\s*(and|also|plus|vs\.?|versus|compare\s+(it|that|this)?\s*(to|with|against)|how\s+does\s+(it|that)\s+compare\s+(to|with))\b/i;

export function planMarket(text: string, s: SessionState): MarketPlan | null {
  const prev = s.lastMarket;
  const afterMarket = s.lastIntent === "market" && prev != null;

  // "Which city's market?" -> "Yorba Linda"
  if (s.lastIntent === "need_market_city" && prev) {
    const city = parsePropertyQuery(text).city ?? bareCity(text);
    if (city) return { kind: "market", cities: [city], months: prev.months, type: prev.type, beds: prev.beds, wantsRecentSales: false };
  }

  if (isMarketQuestion(text)) {
    const q = parseMarketQuery(text);
    let cities = q.cities;
    let type = q.type, beds = q.beds;
    // "compare it with Tustin" right after an Irvine report
    if (afterMarket && cities.length === 1 && ADD_TO_COMPARE.test(text) && !prev!.cities.includes(cities[0])) {
      cities = [...prev!.cities, cities[0]];
    }
    // "how's the market?" with no city: reuse the city (and type) they were just looking at
    if (!cities.length) {
      const fromSession = prev?.cities.length ? prev.cities : s.filters.city ? [s.filters.city] : [];
      cities = fromSession;
      type = type ?? (prev?.type ?? s.filters.type ?? null);
      beds = beds ?? (prev?.beds ?? s.filters.beds ?? null);
    }
    if (!cities.length) return { kind: "need_market_city", months: q.months, type, beds };
    return { kind: "market", cities, months: q.months, type, beds, wantsRecentSales: q.wantsRecentSales };
  }

  // Follow-ups right after a market answer: "what about Tustin", "and Tustin?", "condos only", "last 3 months"
  if (afterMarket) {
    const p = prev!;
    const f = parsePropertyQuery(text);
    // "show me condos in Tustin" / "under 1M" after a market answer means they want listings now
    if (f.maxPrice != null || f.minPrice != null || f.pool || f.hasView || SEARCH_VERBS.test(text)) return null;
    const city = cityFromFollowUp(text) ?? f.city;
    const months = HAS_WINDOW.test(text) ? parseMarketQuery(text).months : p.months;
    const type = f.type ?? p.type;
    const beds = f.beds ?? p.beds;
    if (city && ADD_TO_COMPARE.test(text) && !p.cities.includes(city)) {
      return { kind: "market", cities: [...p.cities, city].slice(0, 5), months, type, beds, wantsRecentSales: false };
    }
    if (city) return { kind: "market", cities: [city], months, type, beds, wantsRecentSales: false };
    // Only tweak the market if the message is clearly about the window or a type, not a new listing search
    const tweak = HAS_WINDOW.test(text) || /^\s*(only|just|what\s+about|how\s+about)\b/i.test(text);
    if (tweak && (months !== p.months || type !== p.type || beds !== p.beds)) {
      return { kind: "market", cities: p.cities, months, type, beds, wantsRecentSales: false };
    }
  }
  return null;
}
