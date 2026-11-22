// Shared set-up for the API tests: a fresh app over a fresh in-memory database, with a
// fixed clock so dates in the results are known in advance.

// Supertest sends HTTP requests straight to an Express app, without opening a port.
import request from 'supertest';
// The app under test, and the options a test may override.
import { type AppOptions, createApp } from '../src/app.ts';
// Opens a database; IN_MEMORY makes one that vanishes when the test ends.
import { type Db, IN_MEMORY, openDb, toSqlTime } from '../src/db.ts';

// The HTTP status codes the tests expect, by name, so each check says what it means.
export const OK = 200;
export const CREATED = 201;
export const FOUND = 302;
export const BAD_REQUEST = 400;
export const NOT_FOUND = 404;
export const CONFLICT = 409;
export const GONE = 410;
export const TOO_MANY_REQUESTS = 429;
export const SERVER_ERROR = 500;

// The moment every test runs at, unless it says otherwise: noon UTC on 22 November 2026.
export const NOW = new Date('2026-11-22T12:00:00Z');

// A link that passes every check, for tests that only need some link to exist.
export const GOOD_URL = 'https://example.com/a/long/path?with=query';

// Builds a fresh app. `overrides` can swap the clock, the code generator or the limit.
export function makeApp(overrides: Partial<AppOptions> = {}) {
  // A new empty database for this test alone.
  const db = openDb(IN_MEMORY);
  // The fixed clock first, so a test's own `now` override still wins.
  const app = createApp({ db, now: () => NOW, ...overrides });
  // `api` is a Supertest agent bound to this app; `db` lets a test check or seed rows directly.
  return { api: request(app), db };
}

// Inserts a link straight into the database, for states the API refuses to create,
// such as a link that has already expired.
export function insertLinkRow(db: Db, code: string, url: string, expiresAt: Date | null = null): number {
  // RETURNING id gives back the new row's id for inserting clicks against it.
  const row = db
    .prepare('INSERT INTO links (code, url, created_at, expires_at) VALUES (?, ?, ?, ?) RETURNING id')
    .get(code, url, toSqlTime(NOW), expiresAt === null ? null : toSqlTime(expiresAt)) as { id: number };
  // The id the clicks table points at.
  return row.id;
}

// Inserts one click at a given moment, with an optional referring host.
export function insertClick(db: Db, linkId: number, at: Date, host: string | null = null): void {
  // Same columns the redirect route fills in.
  db.prepare('INSERT INTO clicks (link_id, clicked_at, referrer_host) VALUES (?, ?, ?)').run(linkId, toSqlTime(at), host);
}
