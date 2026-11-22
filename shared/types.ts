// The shapes the client and the server agree on. Both sides load this file with `import type`,
// so it disappears when the code runs and only the type checker reads it.

// What the client sends to create a link. Only `url` is required.
export interface CreateLink {
  // The long link to shorten; http or https only.
  url: string;
  // A custom code instead of a random one, such as "gym-plan".
  alias?: string;
  // When the link stops working, as an ISO date-time string; left out means never.
  expiresAt?: string;
}

// One short link, as the API returns it.
export interface Link {
  // The short code: 7 random characters, or the alias.
  code: string;
  // Where the short link redirects to.
  url: string;
  // When it was made (UTC, 'YYYY-MM-DD HH:MM:SS', as SQLite writes it).
  createdAt: string;
  // When it stops working, in the same format, or null for never.
  expiresAt: string | null;
}

// Clicks on one day, for the 30-day chart.
export interface DayCount {
  // The UTC day, 'YYYY-MM-DD'.
  day: string;
  // Clicks that day; 0 when there were none.
  clicks: number;
}

// Clicks from one referring site.
export interface ReferrerCount {
  // The referring host, such as 'news.ycombinator.com', or '(direct)' when there was none.
  host: string;
  // Clicks from that host.
  clicks: number;
}

// A link together with its click statistics, for the stats page.
export interface LinkStats extends Link {
  // Every click ever recorded.
  totalClicks: number;
  // The time of the latest click, or null if it was never clicked.
  lastClickAt: string | null;
  // 30 entries, oldest day first, including days with no clicks.
  daily: DayCount[];
  // Up to 5 referrers, most clicks first.
  referrers: ReferrerCount[];
}

// One problem with a request body, tied to the field it is about.
export interface Issue {
  // The field name, such as 'url' or 'alias'.
  field: string;
  // A sentence a person can read.
  message: string;
}

// Every error the API sends back has this shape.
export interface ApiError {
  // What went wrong, in one sentence.
  error: string;
  // Present on 400 answers: one entry per invalid field.
  issues?: Issue[];
}
