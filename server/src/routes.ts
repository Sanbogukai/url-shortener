// The JSON API under /api: create a link, and read one link with its stats.

// Router groups routes; Request and Response are only types.
import { type Request, type Response, Router } from 'express';
// Limits how often one visitor may call a route.
import { rateLimit } from 'express-rate-limit';
// Zod checks request bodies against a schema.
import { z } from 'zod';
// The services the routes use: database, clock, code generator, limit.
import type { AppDeps } from './app.ts';
// Alias rules shared with the redirect route.
import { ALIAS_MAX, ALIAS_MIN, ALIAS_PATTERN, type CodeGenerator, isReserved, looksLikeCode } from './codes.ts';
// Formats times the way SQLite stores them.
import { type Db, toSqlTime } from './db.ts';
// The SQL for links and clicks.
import { findLink, getStats, insertLink, isCodeTaken, type LinkRow, type NewLink, toLink } from './links.ts';
// The error shapes shared with the client.
import type { ApiError, Issue } from '../../shared/types.ts';

// Status codes used below, named so the code says what each one means.
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_SERVICE_UNAVAILABLE = 503;

// What the client shows in its banner when the link safety check cannot run.
export const CHECK_UNAVAILABLE = 'Link safety checks are temporarily unavailable. Please try again in a few minutes.';
// Seconds a client is told to wait before trying again after that 503.
const RETRY_AFTER_SECONDS = 120;

// Browsers handle URLs up to about 2,000 characters reliably, so longer ones are refused.
const MAX_URL = 2048;
// A random code that clashes is drawn again, at most this many times in all. With 3.5
// trillion codes, needing even a second draw is rare; five clashes in a row means a bug.
export const MAX_CODE_ATTEMPTS = 5;
// The rate limit counts requests over one minute.
const MINUTE_MS = 60_000;

// Only web links may be shortened. This keeps out javascript: and data: links, which run
// code or carry content instead of pointing at a page.
// Example: "http" and "https" match; "javascript", "ftp" and "data" do not.
// Try it: https://regex101.com/?regex=%5Ehttps%3F%24&flags=gm&flavor=javascript&testString=http%0Ahttps%0Ajavascript%0Aftp%0Adata
const WEB_PROTOCOL = /^https?$/;

// The body of POST /api/links. Only url is required.
const createBody = z.object({
  // A full web address on a real domain name. z.regexes.domain needs a name with a dot and
  // a top-level part (example.com), so localhost and bare IP addresses are refused: a public
  // shortener should not point visitors at private machines.
  url: z
    .url({
      protocol: WEB_PROTOCOL,
      hostname: z.regexes.domain,
      error: 'Enter a full web link, such as https://example.com/page',
    })
    .max(MAX_URL, `Links are limited to ${MAX_URL.toLocaleString('en-CA')} characters`),
  // An optional custom code. The pattern allows letters, digits and hyphens only.
  alias: z
    .string()
    .regex(ALIAS_PATTERN, `Aliases are ${ALIAS_MIN} to ${ALIAS_MAX} letters, digits or hyphens`)
    .refine((alias) => !isReserved(alias), 'That alias is reserved; pick another')
    .optional(),
  // An optional expiry moment as an ISO date-time, with Z or an offset such as -05:00.
  expiresAt: z.iso.datetime({ offset: true, error: 'Enter a valid date and time' }).optional(),
});

// Answers 400 with one entry per problem, so the client can show each under its field.
function badRequest(res: Response, issues: Issue[]): void {
  // Typed as ApiError so the body always has the shape the client reads.
  const body: ApiError = { error: 'Validation failed', issues };
  // 400 means "your request was wrong".
  res.status(HTTP_BAD_REQUEST).json(body);
}

// Stores the link under a fresh random code, drawing again when the code is taken or happens
// to be a reserved word. Recursion keeps the retry readable: each call is one attempt.
function insertWithRandomCode(db: Db, generate: CodeGenerator, fields: Omit<NewLink, 'code'>, attempt = 1): LinkRow {
  // One new candidate code.
  const code = generate();
  // A reserved word counts as taken; it is skipped without asking the database.
  if (isReserved(code)) return retry(db, generate, fields, attempt);
  try {
    // The UNIQUE index refuses the insert if another link already has this code.
    return insertLink(db, { ...fields, code });
  } catch (err) {
    // A taken code is expected now and then: draw another. Any other error is a real fault.
    if (isCodeTaken(err)) return retry(db, generate, fields, attempt);
    throw err;
  }
}

// The next attempt, or a server error once the attempts run out.
function retry(db: Db, generate: CodeGenerator, fields: Omit<NewLink, 'code'>, attempt: number): LinkRow {
  // Five clashes in a row should never happen; the error handler turns this into a 500.
  if (attempt >= MAX_CODE_ATTEMPTS) throw new Error(`No free code after ${MAX_CODE_ATTEMPTS} attempts`);
  // Tries again with the attempt counter one higher.
  return insertWithRandomCode(db, generate, fields, attempt + 1);
}

// Checks that need more than the schema: the clock and the request's own host name.
function extraIssues(req: Request, url: string, expiresAt: string | undefined, now: Date): Issue[] {
  // Collected here and returned together, so the form can show every problem at once.
  const issues: Issue[] = [];
  // A link to this shortener would send visitors round in a loop.
  if (new URL(url).hostname === req.hostname) {
    issues.push({ field: 'url', message: 'That is already a short link' });
  }
  // An expiry in the past would make a link that never works.
  if (expiresAt !== undefined && new Date(expiresAt) <= now) {
    issues.push({ field: 'expiresAt', message: 'The expiry must be in the future' });
  }
  // Empty when everything is fine.
  return issues;
}

// Builds the /api router. It is a function, not a shared object, so each app gets its own
// rate limiter and its own counts; tests then never use up each other's limit.
export function apiRouter(deps: AppDeps): Router {
  // The routes below are attached to this router; app.ts mounts it at /api.
  const router = Router();

  // At most deps.createLimit new links per visitor per minute, so a script cannot fill the
  // database. Visitors are told apart by IP address, counted in memory and never stored.
  const createLimiter = rateLimit({
    windowMs: MINUTE_MS,
    limit: deps.createLimit,
    // Sends the RateLimit header so a client can see how many requests are left.
    standardHeaders: 'draft-8',
    // Leaves out the older X-RateLimit-* headers.
    legacyHeaders: false,
    // Answers 429 "too many requests" in the API's usual JSON shape.
    handler: (_req, res, _next, options) => {
      const body: ApiError = { error: 'Too many new links; try again in a minute' };
      res.status(options.statusCode).json(body);
    },
  });

  // At most deps.lookupLimit stats lookups per visitor per minute. Stats are public to
  // anyone who has the code, so this keeps a script from guessing codes to read them.
  const lookupLimiter = rateLimit({
    windowMs: MINUTE_MS,
    limit: deps.lookupLimit,
    // Same headers as the create limit.
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Answers 429 in the API's usual JSON shape.
    handler: (_req, res, _next, options) => {
      const body: ApiError = { error: 'Too many lookups; try again in a minute' };
      res.status(options.statusCode).json(body);
    },
  });

  // Create a link from { url, alias?, expiresAt? }.
  // Async because of the Safe Browsing check; Express 5 passes a rejected promise to the
  // error handler.
  router.post('/links', createLimiter, async (req, res) => {
    // safeParse checks without throwing; `?? {}` treats a missing body as an empty one.
    const parsed = createBody.safeParse(req.body ?? {});
    // Each Zod issue becomes { field, message }; path is an array such as ['url'].
    if (!parsed.success) {
      badRequest(res, parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })));
      return;
    }
    // The checked values, now with their proper types.
    const { url, alias, expiresAt } = parsed.data;
    // One reading of the clock, so every time below agrees.
    const now = deps.now();
    // The checks the schema cannot do.
    const issues = extraIssues(req, url, expiresAt, now);
    if (issues.length > 0) {
      badRequest(res, issues);
      return;
    }
    // Asked last, after the free checks, so a bad request never costs a lookup.
    const verdict = await deps.checkUrl(url);
    // A link Google lists as phishing or malware is refused, so the shortener cannot disguise it.
    if (verdict === 'unsafe') {
      badRequest(res, [{ field: 'url', message: 'Google Safe Browsing lists this link as unsafe' }]);
      return;
    }
    // Google could not be asked: nothing unchecked is shortened. 503 "service unavailable"
    // tells the client to show its notice banner; Retry-After suggests when to try again.
    if (verdict === 'unavailable') {
      const body: ApiError = { error: CHECK_UNAVAILABLE };
      res.status(HTTP_SERVICE_UNAVAILABLE).set('Retry-After', String(RETRY_AFTER_SECONDS)).json(body);
      return;
    }
    // Everything except the code, with times in SQLite's format.
    const fields = {
      url,
      createdAt: toSqlTime(now),
      // An expiry given with an offset is converted to UTC before it is stored.
      expiresAt: expiresAt === undefined ? null : toSqlTime(new Date(expiresAt)),
    };

    // No alias: a random code, drawn again on a clash.
    if (alias === undefined) {
      res.status(HTTP_CREATED).json(toLink(insertWithRandomCode(deps.db, deps.generateCode, fields)));
      return;
    }
    try {
      // The alias is the code. Inserting and catching the clash is safer than checking
      // first: two requests for the same alias at once cannot both get through.
      res.status(HTTP_CREATED).json(toLink(insertLink(deps.db, { ...fields, code: alias })));
    } catch (err) {
      // Any other failure goes on to the error handler as a 500.
      if (!isCodeTaken(err)) throw err;
      // 409 "conflict": the request was fine, but the alias belongs to another link.
      const body: ApiError = { error: 'Alias taken', issues: [{ field: 'alias', message: 'That alias is already taken' }] };
      res.status(HTTP_CONFLICT).json(body);
    }
  });

  // One link with its stats.
  // The route string is also passed as a type, because with the limiter in front TypeScript
  // can no longer work out on its own that req.params has a code.
  router.get<'/links/:code'>('/links/:code', lookupLimiter, (req, res) => {
    // A value that cannot be a code is not looked up at all.
    const row = looksLikeCode(req.params.code) ? findLink(deps.db, req.params.code) : undefined;
    if (row === undefined) {
      const body: ApiError = { error: 'No such link' };
      res.status(HTTP_NOT_FOUND).json(body);
      return;
    }
    // Expired links still have stats; only the redirect stops working.
    res.json(getStats(deps.db, row, deps.now()));
  });

  // app.ts mounts this at /api.
  return router;
}
