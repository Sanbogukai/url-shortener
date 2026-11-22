// The server's entry point: builds the app and starts listening.
// Node 26 runs this .ts file directly by stripping out the types; there is no build step.

// Builds the Express app with every route attached.
import { createApp } from './app.ts';

// Render (and other hosts) choose the port through PORT; 3000 is the local default.
const DEFAULT_PORT = 3000;
// Number() turns the text "10000" into 10000; `||` falls back when PORT is missing or not a number.
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

// Starts the HTTP server on PORT; the callback runs once it is ready.
createApp().listen(PORT, () => {
  // Confirms the server is up and where.
  console.log(`Listening on http://localhost:${PORT}`);
});
