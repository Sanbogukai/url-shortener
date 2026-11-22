// Sample links for a fresh database, so the live demo has something to show: a stats page
// with a chart that has a shape, an alias, and a link that has already expired. Run it with
// `npm run seed`, or set SEED_IF_EMPTY=1 and the server seeds an empty database when it
// starts. On Render's free tier the database is wiped on every restart, so that is how the
// demo refills itself.

// The connection type, the real database, and the time format SQLite stores.
import { type Db, openDb, toSqlTime } from './db.ts';
// Day length, the chart's span, and the insert helpers the API uses too.
import { DAY_MS, insertLink, recordClick, STATS_DAYS } from './links.ts';

// One sample link. Ages are in whole days before now.
interface SampleLink {
  // A fixed code, so the README and the checks can name these links.
  code: string;
  url: string;
  // How long ago it was made; clicks start from then.
  createdDaysAgo: number;
  // How long ago it expired, or null for a link that never does. Clicks stop then.
  expiredDaysAgo: number | null;
  // Scales its clicks, so the links are not all equally busy.
  weight: number;
}

// Ages, in days before now. The chart's oldest day is STATS_DAYS - 1 back.
const WHOLE_CHART = STATS_DAYS - 1;
const FOUR_WEEKS = 28;
const THREE_WEEKS = 21;
const TWELVE_DAYS = 12;
const THREE_DAYS = 3;

// How busy each link is: its clicks are scaled by this.
const QUIET = 1;
const LIGHT = 2;
const STEADY = 3;
const BUSY = 4;
const BUSIEST = 6;

// The samples: stable developer docs, nothing personal. The first has a custom alias, the
// next four have random-looking 7-character codes like the generator makes, and the last
// has an alias and expired three days ago.
const SAMPLES: SampleLink[] = [
  { code: 'mdn-fetch', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', createdDaysAgo: WHOLE_CHART, expiredDaysAgo: null, weight: BUSIEST },
  { code: 'r8Kq2Zx', url: 'https://nodejs.org/api/', createdDaysAgo: WHOLE_CHART, expiredDaysAgo: null, weight: STEADY },
  { code: 'Tb4nW9e', url: 'https://expressjs.com/en/5x/api.html', createdDaysAgo: THREE_WEEKS, expiredDaysAgo: null, weight: LIGHT },
  { code: 'p2VxL7m', url: 'https://vite.dev/guide/', createdDaysAgo: TWELVE_DAYS, expiredDaysAgo: null, weight: BUSY },
  { code: 'Hc6sJ3d', url: 'https://www.sqlite.org/lang_datefunc.html', createdDaysAgo: WHOLE_CHART, expiredDaysAgo: null, weight: QUIET },
  { code: 'old-promo', url: 'https://react.dev/learn', createdDaysAgo: FOUR_WEEKS, expiredDaysAgo: THREE_DAYS, weight: STEADY },
];

// Where the sample clicks say they came from, used in turn; null is a direct visit.
const REFERRERS = ['github.com', 'news.ycombinator.com', null, 'www.reddit.com', 'stackoverflow.com', null];

// Clicks rise and fall over a week, like real traffic with quiet weekends.
const WEEK_DAYS = 7;
// One whole turn of the sine wave (2 pi), so the pattern repeats every WEEK_DAYS.
const FULL_TURN = Math.PI + Math.PI;
// Lifts the wave so its lowest point is 0 rather than -1.
const WAVE_LIFT = 1;
// Gap between the sample clicks within a day, 37 minutes, so they do not share one second.
const CLICK_SPACING_MS = 2_220_000;

// How many clicks a link gets on the day `daysAgo` days before now: a weekly wave that grows
// toward today, scaled by the link's weight. Math.round makes it a whole number.
export function sampleClicks(daysAgo: number, weight: number): number {
  // 0 to 2 over each week.
  const wave = Math.sin((daysAgo / WEEK_DAYS) * FULL_TURN) + WAVE_LIFT;
  // 1 today, falling toward 0 at the far end of the chart.
  const growth = (STATS_DAYS - daysAgo) / STATS_DAYS;
  return Math.round(weight * wave * growth);
}

// Every day a sample link was live, newest first: from its expiry (or today) back to its
// creation (or the chart's oldest day), as days before now.
function liveDays(sample: SampleLink): number[] {
  // The chart covers STATS_DAYS days, today included, so the oldest is STATS_DAYS - 1 back.
  const oldest = Math.min(sample.createdDaysAgo, STATS_DAYS - 1);
  // An expired link got no clicks after it expired; the others count up to today (0).
  const newest = sample.expiredDaysAgo ?? 0;
  // Array.from with a length makes one slot per day; slot i is newest + i days back.
  return Array.from({ length: oldest - newest + 1 }, (_, i) => newest + i);
}

// Adds the samples to an empty database and returns how many links it added. A database
// that already has links is left alone, so restarting never doubles them.
export function seedIfEmpty(db: Db, now: Date): number {
  // COUNT(*) is 0 only for an empty links table.
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM links').get() as { count: number };
  if (count > 0) return 0;

  // The moment `days` days before now.
  const daysBefore = (days: number) => new Date(now.getTime() - days * DAY_MS);

  // One transaction: much faster for hundreds of inserts, and all-or-nothing if one fails.
  // db.transaction() wraps the function; the trailing () runs it.
  db.transaction(() => {
    SAMPLES.forEach((sample) => {
      // The link itself, through the same insert the API uses.
      const row = insertLink(db, {
        code: sample.code,
        url: sample.url,
        createdAt: toSqlTime(daysBefore(sample.createdDaysAgo)),
        expiresAt: sample.expiredDaysAgo === null ? null : toSqlTime(daysBefore(sample.expiredDaysAgo)),
      });
      // Its clicks, day by day.
      liveDays(sample).forEach((daysAgo) => {
        // One slot per click that day, numbered from 0.
        const slots = Array.from({ length: sampleClicks(daysAgo, sample.weight) }, (_, i) => i);
        slots.forEach((i) => {
          // Each extra click a little earlier in the day, so none is later than now.
          const at = new Date(daysBefore(daysAgo).getTime() - (i + 1) * CLICK_SPACING_MS);
          // Picks a referrer by position, so the list gets a mix; ?? null satisfies the type.
          recordClick(db, row.id, REFERRERS[(daysAgo + i) % REFERRERS.length] ?? null, at);
        });
      });
    });
  })();

  // Every sample was added.
  return SAMPLES.length;
}

// `npm run seed` runs this file directly; when another file imports it, this part is skipped.
if (import.meta.main) {
  // The real database, seeded as of now.
  const added = seedIfEmpty(openDb(), new Date());
  // Says what happened, including when there was nothing to do.
  console.log(added > 0 ? `Seeded ${added} sample links.` : 'The database already has links; nothing seeded.');
}
