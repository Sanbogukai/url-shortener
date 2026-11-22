// Every SQL query about links and clicks. The route files handle HTTP and call these, so
// the SQL sits in one place and the routes stay short.

// SqliteError is the error class better-sqlite3 throws; its `code` names the failure.
import Database from 'better-sqlite3';
// The connection type and the helpers that format times the way SQLite stores them.
import { type Db, toSqlDay, toSqlTime } from './db.ts';
// The shapes the API sends back.
import type { DayCount, Link, LinkStats, ReferrerCount } from '../../shared/types.ts';

// How many days the stats chart covers, today included.
export const STATS_DAYS = 30;
// How many referring sites the stats list.
export const TOP_REFERRERS = 5;
// Milliseconds in a day. UTC has no daylight saving, so every UTC day is exactly this long.
const DAY_MS = 86_400_000;

// One row of the links table, with SQLite's column names.
export interface LinkRow {
  id: number;
  code: string;
  url: string;
  created_at: string;
  expires_at: string | null;
}

// What is needed to store a new link. Times are already in SQLite's format.
export interface NewLink {
  code: string;
  url: string;
  createdAt: string;
  expiresAt: string | null;
}

// Turns a database row into the Link the API returns, renaming columns to camelCase.
export function toLink(row: LinkRow): Link {
  // The internal id stays private; visitors only ever see the code.
  return { code: row.code, url: row.url, createdAt: row.created_at, expiresAt: row.expires_at };
}

// The link with this exact code, or undefined. Codes are case-sensitive: aB3 and ab3 differ.
export function findLink(db: Db, code: string): LinkRow | undefined {
  // The ? placeholder sends the code separately from the SQL text, so it can never be run as SQL.
  return db.prepare('SELECT * FROM links WHERE code = ?').get(code) as LinkRow | undefined;
}

// True when `err` is SQLite refusing a duplicate in a UNIQUE column: here, a code that is
// already taken. Every other error is a real fault and should not be caught.
export function isCodeTaken(err: unknown): boolean {
  // instanceof checks the class; the code tells a UNIQUE clash apart from other failures.
  return err instanceof Database.SqliteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

// Stores a new link and returns its row. Throws a SqliteError when the code is taken; the
// caller decides what that means (try another random code, or answer 409 for an alias).
export function insertLink(db: Db, link: NewLink): LinkRow {
  // RETURNING * hands back the stored row, id included, in the same statement.
  return db
    .prepare('INSERT INTO links (code, url, created_at, expires_at) VALUES (?, ?, ?, ?) RETURNING *')
    .get(link.code, link.url, link.createdAt, link.expiresAt) as LinkRow;
}

// True when the link has an expiry and it has passed.
export function isExpired(row: LinkRow, now: Date): boolean {
  // Times in 'YYYY-MM-DD HH:MM:SS' form compare correctly as plain strings.
  return row.expires_at !== null && row.expires_at <= toSqlTime(now);
}

// Records one visit, with the referring host or null for a direct visit.
export function recordClick(db: Db, linkId: number, referrerHost: string | null, now: Date): void {
  // One row per visit; nothing that identifies the visitor is stored.
  db.prepare('INSERT INTO clicks (link_id, clicked_at, referrer_host) VALUES (?, ?, ?)').run(
    linkId,
    toSqlTime(now),
    referrerHost,
  );
}

// The UTC day `daysBack` days before `now`, as 'YYYY-MM-DD'.
function dayBefore(now: Date, daysBack: number): string {
  // Stepping back in whole days of milliseconds is exact in UTC.
  return toSqlDay(new Date(now.getTime() - daysBack * DAY_MS));
}

// The link together with its totals, a 30-day chart and its top referrers.
export function getStats(db: Db, row: LinkRow, now: Date): LinkStats {
  // COUNT(*) counts every click; MAX of the times is the latest one (NULL when there are none).
  const totals = db
    .prepare('SELECT COUNT(*) AS total, MAX(clicked_at) AS last FROM clicks WHERE link_id = ?')
    .get(row.id) as { total: number; last: string | null };

  // The 30 chart days, oldest first: slot i is (29 - i) days back, so the last slot is today.
  const days = Array.from({ length: STATS_DAYS }, (_, i) => dayBefore(now, STATS_DAYS - 1 - i));
  // Midnight at the start of the oldest chart day; older clicks are left out of the chart.
  const since = `${dayBefore(now, STATS_DAYS - 1)} 00:00:00`;
  // date() cuts a time down to its day, so GROUP BY gives one row per day that had clicks.
  // Days without clicks are simply missing here; they are filled in with 0 below.
  const counted = db
    .prepare(
      `SELECT date(clicked_at) AS day, COUNT(*) AS clicks
       FROM clicks
       WHERE link_id = ? AND clicked_at >= ?
       GROUP BY day`,
    )
    .all(row.id, since) as DayCount[];
  // A Map from day to count makes each lookup below instant.
  const byDay = new Map(counted.map((entry) => [entry.day, entry.clicks]));
  // Every day of the chart, with 0 where the query had no row.
  const daily = days.map((day) => ({ day, clicks: byDay.get(day) ?? 0 }));

  // Direct visits have no host, so COALESCE gives them the label '(direct)' and they are
  // counted as their own row. Ties are sorted by name so the order never changes at random.
  const referrers = db
    .prepare(
      `SELECT COALESCE(referrer_host, '(direct)') AS host, COUNT(*) AS clicks
       FROM clicks
       WHERE link_id = ?
       GROUP BY host
       ORDER BY clicks DESC, host ASC
       LIMIT ?`,
    )
    .all(row.id, TOP_REFERRERS) as ReferrerCount[];

  // The link's own fields plus the numbers.
  return { ...toLink(row), totalClicks: totals.total, lastClickAt: totals.last, daily, referrers };
}
