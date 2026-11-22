// Opens a SQLite database and makes sure the tables exist. The app never opens the database
// itself: index.ts opens the real file and hands it to createApp(), and each test opens a
// fresh in-memory one, so tests never share data and never touch links.db.

// better-sqlite3 is a synchronous SQLite driver: queries return results directly, no await needed.
import Database from 'better-sqlite3';
// Converts a file:// URL into a normal Windows or Linux path.
import { fileURLToPath } from 'node:url';

// The connection type, exported so other files can name it in their parameters.
export type Db = Database.Database;

// The special name SQLite uses for a database that lives only in memory and vanishes on close.
export const IN_MEMORY = ':memory:';

// Where the real database lives: DB_PATH when set, otherwise server/links.db.
export const DEFAULT_DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL('../links.db', import.meta.url));

// Opens (or creates) the database at `path` and creates any missing tables.
export function openDb(path: string = DEFAULT_DB_PATH): Db {
  // Opens the file, creating it if it does not exist yet.
  const db = new Database(path);
  // WAL (write-ahead log) lets reads carry on during a write. An in-memory database has
  // no file to log to, so the setting only applies to real files.
  if (path !== IN_MEMORY) db.pragma('journal_mode = WAL');
  // SQLite ignores foreign keys unless told otherwise, per connection. Without this,
  // ON DELETE CASCADE below would do nothing.
  db.pragma('foreign_keys = ON');

  // IF NOT EXISTS makes every statement safe to run on each start: it only creates what is missing.
  db.exec(`
    -- One row per short link.
    CREATE TABLE IF NOT EXISTS links (
      -- Internal number; the clicks table points at it.
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      -- The random code or the custom alias. UNIQUE makes SQLite refuse a duplicate, which is
      -- how a code collision or a taken alias is caught.
      code       TEXT    NOT NULL UNIQUE,
      -- Where the link redirects to.
      url        TEXT    NOT NULL,
      -- When it was made, in UTC as 'YYYY-MM-DD HH:MM:SS'. The app always fills it in from its
      -- own clock; the default is only a safety net.
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      -- When it stops working, in the same format; NULL means never.
      expires_at TEXT
    );

    -- One row per visit. Only the time and the referring site are kept: no IP address,
    -- no full referrer URL.
    CREATE TABLE IF NOT EXISTS clicks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      -- The link that was visited; deleting a link deletes its clicks.
      link_id       INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      -- When the visit happened, in UTC as 'YYYY-MM-DD HH:MM:SS'.
      clicked_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      -- The referring site's host, such as 'news.ycombinator.com'; NULL for direct visits.
      referrer_host TEXT
    );

    -- The stats queries filter by link and then by time, so one index serves all of them.
    CREATE INDEX IF NOT EXISTS idx_clicks_link_time ON clicks (link_id, clicked_at);
  `);

  // The caller owns the connection from here.
  return db;
}

// Where 'YYYY-MM-DD' ends in an ISO string such as '2026-11-22T09:30:00.000Z'.
const DATE_LENGTH = 10;
// Where 'YYYY-MM-DDTHH:MM:SS' ends, dropping the milliseconds and the Z.
const DATE_TIME_LENGTH = 19;

// Formats a moment the way SQLite stores times: UTC, 'YYYY-MM-DD HH:MM:SS'. Strings in this
// format sort in time order, so SQL can compare them with < and >=.
export function toSqlTime(moment: Date): string {
  // toISOString() is always UTC; the T between date and time becomes a space, as in SQLite.
  return moment.toISOString().slice(0, DATE_TIME_LENGTH).replace('T', ' ');
}

// The UTC day of a moment, 'YYYY-MM-DD'.
export function toSqlDay(moment: Date): string {
  // The first ten characters of the ISO string are the UTC date.
  return moment.toISOString().slice(0, DATE_LENGTH);
}
