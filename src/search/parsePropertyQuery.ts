// Week 2: Natural language property search parser.
// Turns a free-text query like "3 bed condos in Irvine under $1.5M with a pool"
// into a structured filter object that maps to rets_property columns (Week 3 runs the SQL).

export interface PropertyFilters {
  city: string | null;        // L_City
  minPrice: number | null;    // L_SystemPrice >= ?
  maxPrice: number | null;    // L_SystemPrice <= ?
  beds: number | null;        // L_Keyword2 >= ?   (minimum bedrooms)
  baths: number | null;       // LM_Dec_3 >= ?     (minimum bathrooms, supports 2.5)
  sqft: number | null;        // LM_Int2_3 >= ?    (minimum living area)
  type: string | null;        // L_Type_ = ?       (RESO subtype value)
  pool: "True" | "False" | null;    // PoolPrivateYN
  hasView: "True" | "False" | null; // ViewYN
  maxHoa: number | null;      // AssociationFee <= ? (monthly, 0 = no HOA)
}

// User words -> L_Type_ values. Longer phrases first so "single family home" wins over "home".
const TYPE_MAP: [RegExp, string][] = [
  [/\btown\s?(home|house)s?\b/i, "Townhouse"],
  [/\bsingle[\s-]?family\b|\bsfr\b|\bhouses?\b|\bdetached\b/i, "SingleFamilyResidence"],
  [/\bcondo(minium)?s?\b|\bapartments?\b/i, "Condominium"],
  [/\bduplex(es)?\b/i, "Duplex"],
  [/\btriplex(es)?\b/i, "Triplex"],
  [/\b(manufactured|mobile)\s+homes?\b/i, "ManufacturedHome"],
  [/\b(vacant\s+)?land\b|\blots?\b/i, "UnimprovedLand"],
];

// Fallback for queries that name a city without "in", e.g. "San Diego condos under 800k".
// Week 3 can swap this for SELECT DISTINCT L_City from the database.
const KNOWN_CITIES = [
  "Los Angeles", "San Diego", "San Jose", "San Francisco", "Irvine", "Palm Desert",
  "Newport Beach", "Pasadena", "Santa Monica", "Long Beach", "Anaheim", "Riverside",
  "Sacramento", "Fresno", "Oakland", "Bakersfield", "Santa Ana", "Huntington Beach",
  "Glendale", "Burbank", "Torrance", "Palm Springs", "La Jolla", "Malibu", "Beverly Hills",
  "Fremont", "Santa Clara", "Sunnyvale", "Cupertino", "Palo Alto", "Mountain View",
  "Temecula", "Murrieta", "Corona", "Ontario", "Rancho Cucamonga", "Chula Vista",
  "Carlsbad", "Oceanside", "Escondido", "Laguna Beach", "Costa Mesa", "Mission Viejo",
  "Lake Forest", "Tustin", "Orange", "Fullerton", "Thousand Oaks", "Ventura",
  "Santa Barbara", "Santa Clarita", "Lancaster", "Palmdale", "Indio", "La Quinta",
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

// Words that end a city name ("in Irvine under 1M" -> "Irvine")
const CITY_STOP =
  /\s+(?:under|below|over|above|with|w\/|for|that|at|between|priced|near|less|max|and|or|built|from|around|within|having|has|no|without|less|up|budget|\d)|[,.;!?]|$/i;

function toTitle(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// "$1.5M" "1.5 million" "800k" "$800,000" -> number
function parseMoney(num: string, suffix?: string): number {
  let n = Number(num.replace(/,/g, ""));
  const s = (suffix || "").toLowerCase();
  if (s.startsWith("k") || s === "thousand") n *= 1_000;
  else if (s.startsWith("m")) n *= 1_000_000;
  return Math.round(n);
}

const MONEY = String.raw`\$?\s*([\d][\d,]*(?:\.\d+)?)\s*(k|m|mm|mil|million|thousand)?\b`;

// A bare number like "3" right after "under" is probably not a price. Require $, a suffix,
// or a big enough number.
function looksLikePrice(raw: string, suffix?: string, hadDollar?: boolean): boolean {
  return Boolean(hadDollar || suffix || Number(raw.replace(/,/g, "")) >= 10_000);
}

export function parsePropertyQuery(query: string): PropertyFilters {
  const f: PropertyFilters = {
    city: null, minPrice: null, maxPrice: null, beds: null, baths: null,
    sqft: null, type: null, pool: null, hasView: null, maxHoa: null,
  };

  // Normalize number words ("three bedroom" -> "3 bedroom")
  let q = ` ${query} `.replace(/\b(one|two|three|four|five|six|seven|eight)\b/gi,
    (w) => String(NUMBER_WORDS[w.toLowerCase()]));

  // --- HOA first, then remove it so "HOA under $500" isn't read as a price ---
  if (/\bno\s+hoa\b|\bwithout\s+(an?\s+)?hoa\b/i.test(q)) {
    f.maxHoa = 0;
    q = q.replace(/\bno\s+hoa\b|\bwithout\s+(an?\s+)?hoa\b/gi, " ");
  } else {
    const hoa = q.match(
      /\bhoa(?:\s+fees?)?\s*(?:under|below|less than|<|max(?:imum)?|up to|of|at most)?\s*\$?\s*([\d,]+)(?:\s*(?:\/\s*mo(?:nth)?|a month|per month|monthly))?/i);
    if (hoa) {
      f.maxHoa = Number(hoa[1].replace(/,/g, ""));
      q = q.replace(hoa[0], " ");
    }
  }

  // --- Square feet (also remove, so "under 2000 sqft" doesn't become a price) ---
  const sq = q.match(/(?:at least|min(?:imum)?|over|above|more than)?\s*([\d][\d,]*)\s*\+?\s*(?:sq\.?\s*ft\.?|sqft|square\s+feet|square\s+foot|sf)\b/i);
  if (sq) {
    f.sqft = Number(sq[1].replace(/,/g, ""));
    q = q.replace(sq[0], " ");
  }

  // --- Price range: "between 800k and 1.2M", "$800k-$1.2M" ---
  const range = q.match(new RegExp(
    String.raw`(?:between|from)?\s*(\$)?\s*([\d][\d,]*(?:\.\d+)?)\s*(k|m|mm|mil|million|thousand)?\s*(?:and|to|-)\s*(\$)?\s*([\d][\d,]*(?:\.\d+)?)\s*(k|m|mm|mil|million|thousand)\b`, "i"));
  if (range && (range[1] || range[3] || range[4] || range[6])) {
    // "800-1.2M": if only the upper end has a suffix, apply it to the lower end too
    const lowSuffix = range[3] || range[6];
    f.minPrice = parseMoney(range[2], lowSuffix);
    f.maxPrice = parseMoney(range[5], range[6]);
    if (f.minPrice > f.maxPrice && !range[3]) f.minPrice = parseMoney(range[2], "k");
    q = q.replace(range[0], " ");
  }

  // --- Max price: "under $1.5M", "below 900k", "up to 2 million", "budget of 1M" ---
  if (f.maxPrice === null) {
    const re = new RegExp(String.raw`(?:under|below|less than|<|max(?:imum)?(?: price)?(?: of)?|up to|no more than|at most|budget(?: of| is)?|cheaper than)\s*(\$)?` + MONEY, "i");
    const m = q.match(re);
    if (m && looksLikePrice(m[2], m[3], Boolean(m[1]))) {
      f.maxPrice = parseMoney(m[2], m[3]);
      q = q.replace(m[0], " ");
    }
  }

  // --- Min price: "over $500k", "at least 1M", "above 2 million" ---
  if (f.minPrice === null) {
    const re = new RegExp(String.raw`(?:over|above|more than|>|at least|min(?:imum)?(?: price)?(?: of)?|starting at)\s*(\$)?` + MONEY, "i");
    const m = q.match(re);
    if (m && looksLikePrice(m[2], m[3], Boolean(m[1]))) {
      f.minPrice = parseMoney(m[2], m[3]);
      q = q.replace(m[0], " ");
    }
  }

  // --- Beds / baths: "3 bed", "3-bedroom", "3br", "4+ beds", "2.5 baths", "3bd/2ba" ---
  const beds = q.match(/(\d+)\s*\+?\s*-?\s*(?:bd|br|bdr|bed|beds|bedroom|bedrooms)\b/i);
  if (beds) f.beds = Number(beds[1]);
  const baths = q.match(/(\d+(?:\.\d+)?)\s*\+?\s*-?\s*(?:ba|bth|bath|baths|bathroom|bathrooms)\b/i);
  if (baths) f.baths = Number(baths[1]);
  if (/\bstudio\b/i.test(q) && f.beds === null) f.beds = 0;

  // --- Property type ---
  for (const [re, value] of TYPE_MAP) {
    if (re.test(q)) { f.type = value; break; }
  }

  // --- Pool / view (with negation: "no pool", "without a view") ---
  if (/\b(no|without|w\/o)\s+(an?\s+|private\s+)?pool\b/i.test(q)) f.pool = "False";
  else if (/\bpool\b/i.test(q)) f.pool = "True";
  if (/\b(no|without|w\/o)\s+(an?\s+)?views?\b/i.test(q)) f.hasView = "False";
  else if (/\bviews?\b/i.test(q)) f.hasView = "True";

  // --- City ---
  // 1) A known city anywhere in the query wins ("house in the hills of Malibu" -> Malibu)
  const lower = q.toLowerCase();
  const known = KNOWN_CITIES
    .slice().sort((a, b) => b.length - a.length)
    .find((c) => new RegExp(String.raw`\b${c.toLowerCase()}\b`).test(lower));
  if (known) {
    f.city = known;
  } else {
    // 2) Otherwise take the words after "in / near / around": "in Yorba Linda under 1M"
    const cityMatch = q.match(/\b(?:in|near|around|within)\s+(?:the\s+)?([a-z][a-z\s'.-]*)/i);
    if (cityMatch) {
      const raw = cityMatch[1].split(CITY_STOP)[0].trim();
      const candidate = raw.split(/\s+/).filter(Boolean).slice(0, 3).join(" "); // cities are 1-3 words
      // Ignore things like "in the area", "in good condition"
      if (candidate && !/^(the|a|an|good|great|excellent|my|area|california|ca|hills?)$/i.test(candidate)) {
        f.city = toTitle(candidate);
      }
    }
  }

  return f;
}

// Only the filters that were actually found (handy for display / debugging)
export function activeFilters(f: PropertyFilters): Partial<PropertyFilters> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null)) as Partial<PropertyFilters>;
}
