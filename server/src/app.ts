// Builds the Express app without starting it. Tests import createApp() and hand the app to
// Supertest, which sends real HTTP requests to it without opening a port; index.ts imports
// the same function and calls listen. Keeping the two apart is what makes the app testable.

// Express handles HTTP: routing and JSON parsing. The other two are only types.
import express, { type ErrorRequestHandler, type Express } from 'express';
// Joins folder names into a path, with the right separator for the operating system.
import { join } from 'node:path';
// Turns a file: URL into a plain path, which express.static and sendFile expect.
import { fileURLToPath } from 'node:url';
// The code generator, swappable in tests.
import { type CodeGenerator, randomCode } from './codes.ts';
// The database connection type.
import type { Db } from './db.ts';
// GET /:code, and the small HTML page used for addresses with nothing behind them.
import { page, redirectRouter } from './redirect.ts';
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

// How many proxies sit between the visitor and the app on Render (see the comment where
// it is used).
const TRUSTED_PROXY_HOPS = 3;

// New links one visitor may create per minute, unless the caller sets another limit.
export const DEFAULT_CREATE_LIMIT = 20;

// The built client (npm run build in client/). In production one server hands out the page
// and the API, so there is one service and no cross-origin requests. In development Vite
// serves the page instead and this folder may not exist; nothing below needs it to.
export const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

// Vite puts a hash of each file's contents in its name under assets/, so a changed file gets
// a new name. That makes it safe to let browsers keep these for a year without asking again.
const ASSET_MAX_AGE = '1y';

// What the caller passes in. Only the database is required; the rest have real defaults
// and exist so a test can swap them: a fixed clock, a code generator that returns chosen
// codes, a lower rate limit, a folder standing in for the client build.
export interface AppOptions {
  db: Db;
  now?: () => Date;
  generateCode?: CodeGenerator;
  createLimit?: number;
  clientDist?: string;
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
    clientDist: CLIENT_DIST,
    // Anything the caller passed wins over the defaults above.
    ...options,
  };

  // Creates the app that every middleware and route below is attached to.
  const app = express();

  // Render puts three proxies in front of the app: Cloudflare, an internal load balancer
  // (a 10.x address) and a local proxy on the same machine (::1). Each adds the address it
  // got the request from to X-Forwarded-For, so the header reads "visitor, Cloudflare,
  // balancer" and the connection itself comes from the local proxy. Trusting exactly those
  // three hops makes req.ip the visitor's address (for the rate limit), without letting a
  // visitor fake it: anything they send in their own X-Forwarded-For sits further left and
  // is ignored. Trusting fewer hops made req.ip a proxy that changes between requests,
  // which split one visitor's limit across several counters.
  app.set('trust proxy', TRUSTED_PROXY_HOPS);

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

  // The hashed build files, cached for a year (see ASSET_MAX_AGE). `immutable` tells the
  // browser not to re-check them even on a reload.
  app.use('/assets', express.static(join(deps.clientDist, 'assets'), { maxAge: ASSET_MAX_AGE, immutable: true }));
  // Everything else in the build: index.html for /, and the favicon. A missing file or a
  // missing folder just moves on to the next handler.
  app.use(express.static(deps.clientDist));

  // Short links, after /api and the files. A code can never shadow a file, because codes
  // and aliases have no dot in them and every file name does.
  app.use(redirectRouter(deps));

  // A stats page is part of the single-page app: the server sends index.html and the client
  // reads the code from the address. This makes a reload or a shared stats link work.
  app.get('/stats/:code', (_req, res, next) => {
    // If the build is missing (as in development), fall through to the 404 page below
    // instead of the error handler, which would show a file path.
    res.sendFile('index.html', { root: deps.clientDist }, (err) => {
      // The callback runs once sending ends; `err` is set only when it failed.
      if (err) next();
    });
  });

  // Any other address gets a small HTML 404 page, rather than Express's bare default.
  app.use((_req, res) => {
    // 404 "not found", as a page a person can read, with a link home.
    res.status(HTTP_NOT_FOUND).type('html').send(page('Page not found', 'There is nothing at this address.'));
  });

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
