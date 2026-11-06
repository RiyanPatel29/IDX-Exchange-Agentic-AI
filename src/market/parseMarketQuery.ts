// Week 5: spot market questions and pull out city/cities, time window, type and beds.
//
//   "how's the Irvine condo market?"                 -> Irvine, Condominium, 12 months
//   "what are homes selling for in Tustin lately"     -> Tustin, 6 months
//   "median price per sqft in San Diego last 3 months"-> San Diego, 3 months
//   "compare Irvine vs Tustin vs Lake Forest"         -> 3 cities
import { parsePropertyQuery, KNOWN_CITIES } from "../search/parsePropertyQuery.ts";

export interface MarketQuery {
  cities: string[];
  months: number;
  type: string | null;
  beds: number | null;
  compare: boolean;
  wantsRecentSales: boolean;
}

const MARKET_WORDS = new RegExp([
  String.raw`\bmarket\b`, String.raw`\bselling\s+for\b`, String.raw`\bsold\s+for\b`, String.raw`\bsale\s+prices?\b`,
  String.raw`\bsales?\s+(data|stats|numbers|trends?|history)\b`, String.raw`\brecent(ly)?\s+(sold|sales|closings?)\b`,
  String.raw`\bwhat\s+(have|did)\s+\w+\s+sell\b`, String.raw`\bmedian\b`, String.raw`\baverage\s+(sale|sold|home|house|condo|price|value|\$)`,
  String.raw`\bavg\s+(sale|price)\b`, String.raw`\bprice\s+per\s+(sq|square)`, String.raw`\$\s*/\s*sq\s*ft`, String.raw`\bppsf\b`,
  String.raw`\btrends?\b`, String.raw`\bappreciat\w*`, String.raw`\bdays\s+on\s+market\b`,
  String.raw`\bhow\s+(fast|quickly)\b.*\bsell`, String.raw`\binventory\b`, String.raw`\bmonths?\s+of\s+supply\b`,
  String.raw`\bbuyer'?s\s+market\b`, String.raw`\bseller'?s\s+market\b`, String.raw`\bcompare\b`, String.raw`\bvs\.?\b`,
  String.raw`\bversus\b`, String.raw`\bcomps\b`, String.raw`\bhome\s+values?\b`, String.raw`\bprices?\s+(going|trending|up|down|changed?)\b`,
].join("|"), "i");

// "homes in Irvine with a pool" is a search, "Irvine market" is a market question.
export function isMarketQuestion(text: string): boolean {
  return MARKET_WORDS.test(text);
}

export function parseMonths(text: string, today = new Date()): number {
  const t = text.toLowerCase();
  let m = t.match(/\b(?:last|past|previous|over\s+the\s+last|in\s+the\s+last)\s+(\d{1,3})\s*(months?|mos?|weeks?|days?|years?|yrs?)\b/);
  if (m) {
    const n = Number(m[1]), unit = m[2];
    if (unit.startsWith("y")) return Math.min(120, n * 12);
    if (unit.startsWith("w")) return Math.max(1, Math.round(n / 4.35));
    if (unit.startsWith("d")) return Math.max(1, Math.round(n / 30.44));
    return Math.min(120, Math.max(1, n));
  }
  if (/\b(last|past)\s+(quarter|3\s+months)\b|\bthis\s+quarter\b/.test(t)) return 3;
  if (/\b(last|past)\s+(month|30\s+days)\b|\bthis\s+month\b/.test(t)) return 1;
  if (/\b(last|past)\s+(6\s+months|half\s+year)\b|\blately\b|\brecently\b/.test(t)) return 6;
  if (/\bthis\s+year\b|\bytd\b|\byear\s+to\s+date\b/.test(t)) return Math.max(1, today.getMonth() + 1);
  if (/\b(last|past)\s+(two|2)\s+years\b/.test(t)) return 24;
  return 12;
}

const toTitle = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// Words to strip from a "compare A and B" chunk to leave just the city
const FILLER = /\b(compare|comparing|comparison|the|market|markets|prices?|home|homes|house|houses|condos?|condominiums?|townho(me|use)s?|single[\s-]?family|real\s+estate|values?|sales?|in|for|of|between|how|does|do|is|are|stack\s+up|against|last|past|\d+|months?|years?|year|this|quarter|bed(room)?s?|br|bd|median|average|price|per|sq(uare)?\s*f(ee|oo)?t|sqft|what|about|right\s+now|now|today|me|show|tell|stats|data|numbers|which|better|cheaper|than|bigger|hotter|it|that|this|them|there|here|ones?|they|we|i|you|my|our)\b/gi;

function cityFromChunk(chunk: string): string | null {
  const t = chunk.replace(/[?.!$]/g, " ");
  const lower = ` ${t.toLowerCase()} `;
  const known = KNOWN_CITIES.slice().sort((a, b) => b.length - a.length)
    .find((c) => lower.includes(` ${c.toLowerCase()} `) || lower.includes(` ${c.toLowerCase()}'s `));
  if (known) return known;
  const rest = t.replace(/'s\b/gi, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim();
  if (!rest || rest.split(" ").length > 3 || !/^[a-z][a-z .'-]*$/i.test(rest)) return null;
  return toTitle(rest);
}

// "compare Irvine, Tustin and Lake Forest condos" -> ["Irvine", "Tustin", "Lake Forest"]
export function parseCompareCities(text: string): string[] {
  if (!/\b(compare|vs\.?|versus|against|stack\s+up)\b/i.test(text)) return [];
  const chunks = text
    .replace(/\b(last|past)\s+\d+\s+\w+/gi, " ")
    .split(/\s*(?:\bvs\.?(?=\s|$)|\bversus\b|\band\b|,|\bor\b|\bwith\b|\bto\b|\bagainst\b|&)\s*/i);
  const out: string[] = [];
  for (const c of chunks) {
    const city = cityFromChunk(c);
    if (city && !out.includes(city)) out.push(city);
  }
  return out.slice(0, 5);
}

export function parseMarketQuery(text: string, today = new Date()): MarketQuery {
  const f = parsePropertyQuery(text);
  const compareCities = parseCompareCities(text);
  let cities = compareCities.length >= 2 ? compareCities : [];
  if (!cities.length) {
    const one = f.city ?? cityFromPossessive(text) ?? (compareCities[0] || null);
    if (one) cities = [one];
  }
  return {
    cities,
    months: parseMonths(text, today),
    type: f.type,
    beds: f.beds,
    compare: cities.length >= 2,
    wantsRecentSales: /\b(recent(ly)?\s+(sold|sales|closings?)|comps|what\s+(have|did)\s+\w+\s+sell)\b/i.test(text),
  };
}

// "how's the Yorba Linda market" / "Yorba Linda's market" (city not in the known list, no "in")
function cityFromPossessive(text: string): string | null {
  const m = text.match(/\b(?:the\s+)?([A-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*){0,2})(?:'s)?\s+(?:condo\s+|home\s+|housing\s+|real\s+estate\s+|house\s+|townhome\s+)?market\b/);
  if (!m) return null;
  const c = m[1].trim();
  return /^(The|How|What|Is|Housing|Real|Home|Condo|Hot)$/.test(c) ? null : c;
}
