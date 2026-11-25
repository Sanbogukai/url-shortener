// The server's entry point: opens the database, builds the app and starts listening.
// Node 26 runs this .ts file directly by stripping out the types; there is no build step.

// Builds the Express app with every route attached.
import { createApp } from './app.ts';
// Opens server/links.db, or the file named by DB_PATH.
import { openDb } from './db.ts';
// The Safe Browsing check, or the stand-in that allows every link.
import { allowAll, createSafeBrowsingChecker } from './safeBrowsing.ts';
// Sample links for an empty database.
import { seedIfEmpty } from './seed.ts';

// Render (and other hosts) choose the port through PORT; 3000 is the local default.
const DEFAULT_PORT = 3000;
// Number() turns the text "10000" into 10000; `||` falls back when PORT is missing or not a number.
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

// The real database file.
const db = openDb();

// With SEED_IF_EMPTY set (as on the Render demo, whose database is wiped on every restart),
// an empty database gets the sample links.
if (process.env.SEED_IF_EMPTY) {
  // Logs how many were added; 0 means the database already had links.
  console.log(`Seeded ${seedIfEmpty(db, new Date())} sample links.`);
}

// The Safe Browsing key, set in Render's environment. Without one, links are not checked;
// the log says so, so a missing key is noticed rather than silently weakening the app.
const apiKey = process.env.SAFE_BROWSING_API_KEY;
if (!apiKey) console.warn('SAFE_BROWSING_API_KEY is not set; links are not checked against Safe Browsing.');
// The real checker when there is a key, otherwise one that allows everything.
const checkUrl = apiKey ? createSafeBrowsingChecker({ apiKey }) : allowAll;

// The app over that database, with the real clock and code generator (the defaults).
const app = createApp({ db, checkUrl });

// Starts the HTTP server on PORT; the callback runs once it is ready.
app.listen(PORT, () => {
  // Confirms the server is up and where.
  console.log(`Listening on http://localhost:${PORT}`);
});
