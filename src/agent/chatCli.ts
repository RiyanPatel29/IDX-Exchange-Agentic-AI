// Week 4 entry point for OpenClaw: one message in, one reply out, with memory per user.
//
//   npm run -s chat -- --user "+15551234567" "3 bed condos in Irvine under 1.5M"
//   npm run -s chat -- --user "+15551234567" "only ones with a pool"
//   npm run -s chat -- --user "+15551234567" "more"
//   npm run -s chat -- --user "+15551234567" "tell me about #2"
//   npm run -s chat -- --user me --session      (print the saved session, for debugging)
//   npm run -s chat -- --user me --reset
//
// If the message isn't a property request, it prints NOT_A_PROPERTY_REQUEST so the
// agent knows to answer the user itself.
import { handleMessage, type Deps } from "./handleMessage.ts";
import { FileSessionStore } from "../session/sessionStore.ts";
import { searchActiveListings, getListingById } from "../db/listings.ts";
import { closePool } from "../db/pool.ts";

function parseArgs(argv: string[]) {
  const words: string[] = [];
  const o = { user: process.env.IDX_USER || "me", reset: false, session: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--user") o.user = argv[++i] ?? "me";
    else if (a === "--reset") o.reset = true;
    else if (a === "--session") o.session = true;
    else if (a === "--json") o.json = true;
    else words.push(a);
  }
  return { text: words.join(" ").trim(), o };
}

export function defaultDeps(): Deps {
  return { store: new FileSessionStore(), search: searchActiveListings, getListing: getListingById };
}

async function main() {
  const { text, o } = parseArgs(process.argv.slice(2));
  const deps = defaultDeps();

  if (o.session) { console.log(JSON.stringify(await deps.store.get(o.user), null, 2)); return; }
  if (o.reset) { await deps.store.clear(o.user); console.log("Session cleared."); return; }
  if (!text) {
    console.error('Usage: npm run -s chat -- --user "<sender id>" "<message>"');
    process.exit(1);
  }

  const reply = await handleMessage(o.user, text, deps);
  if (o.json) { console.log(JSON.stringify(reply, null, 2)); return; }
  console.log(reply.text ?? "NOT_A_PROPERTY_REQUEST");
}

main()
  .catch((err) => {
    const msg = String(err?.message || err);
    if (/ECONNREFUSED|Access denied|ER_ACCESS|ER_BAD_DB/i.test(msg)) {
      console.error("Can't reach the MLS database. Check MySQL is running (sudo systemctl start mysql) and .env settings.");
    } else {
      console.error("Something went wrong:", msg);
    }
    process.exitCode = 1;
  })
  .finally(closePool);
