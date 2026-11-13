// Week 7: spot recommendation messages. Pure, unit tested.
//
//   "recommend homes in Irvine under 1.5M", "best deals in Tustin"   -> recommend
//   "homes like #2", "similar to the second one", "more like this"   -> similar
//   "I like #2", "save #3", "👍 2"                                   -> like
//   "not #3", "hide #4", "don't like #1"                             -> dislike
//   "my favorites"                                                    -> favorites
//   "clear my likes"                                                  -> clear_taste
import { parseDetailsIndex } from "../session/followUp.ts";

export type RecIntent =
  | { kind: "recommend" }
  | { kind: "similar"; index: number | "this" }
  | { kind: "like"; indexes: (number | "this")[] }
  | { kind: "dislike"; indexes: (number | "this")[] }
  | { kind: "favorites" }
  | { kind: "clear_taste" };

const REF = String.raw`(?:#\s*\d{1,3}|(?:number|no\.?|listing|home|house|option|card)\s*#?\s*\d{1,3}|\d{1,2}(?:st|nd|rd|th)\s+one|(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+one|this(?:\s+one)?|that(?:\s+one)?|it)`;

const SIMILAR = new RegExp(String.raw`\b(?:similar\s+to|comparable\s+to|(?:homes?|houses?|condos?|townho\w+|ones?|places?|listings?|properties|something|anything|more|others?)\s+(?:just\s+|kind\s+of\s+|a\s+lot\s+)?like)\s+(?:the\s+)?(${REF})`, "i");
const LIKE = new RegExp(String.raw`(?:\b(?:i\s+(?:really\s+)?(?:like|love|liked|loved|want)|save|favou?rite|bookmark|keep)\s+(?:the\s+)?(${REF})|(?:👍|❤️|♥️)\s*#?\s*\d|(${REF})\s+(?:looks?|is|seems?)\s+(?:great|good|nice|amazing|perfect|awesome|interesting))`, "i");
const DISLIKE = new RegExp(String.raw`(?:\b(?:not|don'?t\s+(?:like|want)|dislike|hate|hide|skip|remove|drop|no\s+to|pass\s+on|not\s+interested\s+in|nah)\s+(?:the\s+)?(${REF})|👎\s*#?\s*\d|(${REF})\s+(?:is|looks?)\s+(?:bad|ugly|terrible|meh|not\s+for\s+me|too\s+\w+))`, "i");

const RECOMMEND = /\b(recommend\w*|suggest\w*|top\s+picks?|best\s+(deals?|value|buys?|picks?|options?|homes?|listings?)|good\s+deals?|great\s+deals?|under-?priced|under-?valued|bargains?|steals?|what\s+should\s+i\s+(buy|look\s+at|see|check\s+out)|picks?\s+for\s+me|something\s+for\s+me|what\s+do\s+you\s+(recommend|suggest|think\s+i\s+should))\b/i;
const FAVORITES = /^\s*(show\s+(me\s+)?)?(my\s+)?(favou?rites|saved(\s+(homes|listings))?|liked(\s+(homes|listings))?|shortlist|homes\s+i\s+liked)\s*[?.!]*\s*$/i;
const CLEAR = /\b(clear|reset|forget|delete)\s+(my\s+)?(likes|favou?rites|saved|preferences|taste|dislikes)\b/i;

// All the listing references in a message: "#2 and #4" -> [2, 4]; "this one" -> ["this"]
export function refsIn(text: string): (number | "this")[] {
  const out: (number | "this")[] = [];
  for (const m of text.matchAll(/#\s*(\d{1,3})\b/g)) out.push(Number(m[1]));
  if (!out.length) {
    const emoji = text.match(/(?:👍|👎|❤️|♥️)\s*(\d{1,3})\b/);
    if (emoji) out.push(Number(emoji[1]));
  }
  if (!out.length) {
    const one = parseDetailsIndex(text);
    if (one != null) out.push(one);
  }
  if (!out.length && /\b(this|that)(\s+one)?\b|\bit\b/i.test(text)) out.push("this");
  return [...new Set(out)];
}

export function parseRecIntent(text: string): RecIntent | null {
  const t = text.trim();
  if (CLEAR.test(t)) return { kind: "clear_taste" };
  if (FAVORITES.test(t)) return { kind: "favorites" };
  if (SIMILAR.test(t)) {
    const refs = refsIn(t.replace(/^.*?(similar\s+to|comparable\s+to|like)\s+/i, ""));
    return { kind: "similar", index: refs[0] ?? "this" };
  }
  if (DISLIKE.test(t)) { const r = refsIn(t); if (r.length) return { kind: "dislike", indexes: r }; }
  if (LIKE.test(t)) { const r = refsIn(t); if (r.length) return { kind: "like", indexes: r }; }
  if (RECOMMEND.test(t)) return { kind: "recommend" };
  return null;
}
