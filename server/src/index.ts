// The server's entry point: opens the database, builds the app and starts listening.
// Node 26 runs this .ts file directly by stripping out the types; there is no build step.

// Builds the Express app with every route attached.
import { createApp } from './app.ts';
// Opens server/links.db, or the file named by DB_PATH.
import { openDb } from './db.ts';

// Render (and other hosts) choose the port through PORT; 3000 is the local default.
const DEFAULT_PORT = 3000;
// Number() turns the text "10000" into 10000; `||` falls back when PORT is missing or not a number.
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

// The real database, with the real clock and code generator (the defaults).
const app = createApp({ db: openDb() });

// Starts the HTTP server on PORT; the callback runs once it is ready.
app.listen(PORT, () => {
  // Confirms the server is up and where.
  console.log(`Listening on http://localhost:${PORT}`);
});
