// Builds the Express app without starting it. Tests import createApp() and hand the app to
// Supertest, which sends real HTTP requests to it without opening a port; index.ts imports
// the same function and calls listen. Keeping the two apart is what makes the app testable.

// Express handles HTTP: routing and JSON parsing. The other two are only types.
import express, { type ErrorRequestHandler, type Express } from 'express';
// The code generator, swappable in tests.
import { type CodeGenerator, randomCode } from './codes.ts';
// The database connection type.
import type { Db } from './db.ts';
// GET /:code.
import { redirectRouter } from './redirect.ts';
// Everything under /api.
import { apiRouter } from './routes.ts';
// The error shape every failure is sent in, shared with the client.
import type { ApiError } from '../../shared/types.ts';

// The largest JSON body accepted. A URL is at most 2,048 characters, so 16 kB is plenty
// and stops anyone posting megabytes at the API.
const JSON_LIMIT = '16kb';

// A request error (4xx) explains itself; anything from 500 up is the server's fault.
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;

// New links one visitor may create per minute, unless the caller sets another limit.
export const DEFAULT_CREATE_LIMIT = 20;

// What the caller passes in. Only the database is required; the rest have real defaults
// and exist so a test can swap them: a fixed clock, a code generator that returns chosen
// codes, a lower rate limit.
export interface AppOptions {
  db: Db;
  now?: () => Date;
  generateCode?: CodeGenerator;
  createLimit?: number;
}

// The same services with every default filled in. The routers receive this.
export type AppDeps = Required<AppOptions>;

// Returns a new, fully wired app. Each call makes a separate app, so every test can have
// its own, with its own database and its own rate-limit counts.
export function createApp(options: AppOptions): Express {
  // Fills in the defaults: the real clock, the real generator and the normal limit.
  const deps: AppDeps = {
    now: () => new Date(),
    generateCode: randomCode,
    createLimit: DEFAULT_CREATE_LIMIT,
    // Anything the caller passed wins over the defaults above.
    ...options,
  };

  // Creates the app that every middleware and route below is attached to.
  const app = express();

  // Render puts one proxy in front of the app. Trusting exactly one hop makes req.ip the
  // visitor's address (for the rate limit) and req.hostname the public host name (for
  // spotting links back to the shortener), without letting visitors fake either.
  app.set('trust proxy', 1);

  // Parses JSON request bodies into req.body, refusing anything over the limit with a 413.
  app.use(express.json({ limit: JSON_LIMIT }));
  // The JSON API: POST /api/links and GET /api/links/:code.
  app.use('/api', apiRouter(deps));

  // Unknown API routes get JSON, not Express's HTML page. It runs only when no route
  // above matched, because a matching route ends the request.
  app.use('/api', (req, res) => {
    // Typed as ApiError so the body always matches what the client expects.
    const body: ApiError = { error: `No route for ${req.method} ${req.originalUrl}` };
    // 404 "not found", naming the method and path that had no route.
    res.status(HTTP_NOT_FOUND).json(body);
  });

  // Short links, after /api so that "api" can never be treated as a code.
  app.use(redirectRouter(deps));

  // Errors always come back as JSON. Bad JSON bodies arrive here with status 400, and
  // bodies over the limit with 413. Express knows this is the error handler because it
  // takes four arguments; `_next` is unused but must be listed.
  const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
    // Use the error's own status when it has one, otherwise 500.
    const status: number = err.status ?? err.statusCode ?? HTTP_SERVER_ERROR;
    // Server faults are logged for debugging; client mistakes (4xx) are not.
    if (status >= HTTP_SERVER_ERROR) console.error(err);
    // A 500 never shows its internal message to the visitor; a 4xx explains what was wrong.
    const body: ApiError = { error: status >= HTTP_SERVER_ERROR ? 'Something went wrong' : err.message };
    // Sends the status and the JSON body together.
    res.status(status).json(body);
  };
  // Added last, so it catches errors from everything above.
  app.use(handleError);

  // The caller decides whether to listen (index.ts) or to test it (Supertest).
  return app;
}
