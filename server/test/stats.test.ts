// GET /api/links/:code: totals, the 30-day chart and the top referrers.

import { describe, expect, it } from 'vitest';
// The size of the chart and of the referrer list.
import { STATS_DAYS, TOP_REFERRERS } from '../src/links.ts';
import { GOOD_URL, insertClick, insertLinkRow, makeApp, NOT_FOUND, NOW, OK } from './helpers.ts';

// A day and an hour in milliseconds, for click times relative to NOW.
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
// Clicks spread over the chart for the counting tests.
const TODAY_CLICKS = 3;
const YESTERDAY_CLICKS = 2;
// The last chart slot is today; the one before it is yesterday.
const TODAY_INDEX = STATS_DAYS - 1;
const YESTERDAY_INDEX = TODAY_INDEX - 1;
// More distinct referrers than the list shows, to check it is cut off.
const EXTRA_REFERRERS = 2;
const REFERRER_COUNT = TOP_REFERRERS + EXTRA_REFERRERS;
// A click this many days back falls before the 30-day chart starts.
const OLD_CLICK_DAYS = 40;
// Visits made in the end-to-end test.
const VISITS = 2;

// The moment `days` days and `hours` hours before NOW.
function ago(days: number, hours = 0): Date {
  return new Date(NOW.getTime() - days * DAY_MS - hours * HOUR_MS);
}

// `count` clicks on one link at the same moment.
function clicks(db: ReturnType<typeof makeApp>['db'], linkId: number, count: number, at: Date, host: string | null = null) {
  // Array.from runs the insert `count` times.
  Array.from({ length: count }, () => insertClick(db, linkId, at, host));
}

describe('link stats', () => {
  it('answers 404 for an unknown code', async () => {
    const res = await makeApp().api.get('/api/links/nothere');

    expect(res.status).toBe(NOT_FOUND);
    expect(res.body).toEqual({ error: 'No such link' });
  });

  it('shows a link with no clicks as zeros, not gaps', async () => {
    const { api, db } = makeApp();
    insertLinkRow(db, 'abc1234', GOOD_URL);

    const res = await api.get('/api/links/abc1234');

    expect(res.status).toBe(OK);
    // The link's own fields, no clicks, no last click, no referrers.
    expect(res.body).toMatchObject({ code: 'abc1234', url: GOOD_URL, totalClicks: 0, lastClickAt: null, referrers: [] });
    // Still a full chart: 30 days, every one 0.
    expect(res.body.daily).toHaveLength(STATS_DAYS);
    expect(res.body.daily.every((entry: { clicks: number }) => entry.clicks === 0)).toBe(true);
  });

  it('lists the 30 chart days oldest first, ending today', async () => {
    const { api, db } = makeApp();
    insertLinkRow(db, 'abc1234', GOOD_URL);

    const res = await api.get('/api/links/abc1234');

    // NOW is 22 November, so the chart runs from 24 October to 22 November.
    expect(res.body.daily.at(0).day).toBe('2026-10-24');
    expect(res.body.daily.at(-1).day).toBe('2026-11-22');
  });

  it('counts clicks per UTC day and in total', async () => {
    const { api, db } = makeApp();
    const id = insertLinkRow(db, 'abc1234', GOOD_URL);
    // Three clicks today, two yesterday, and one 40 days ago, before the chart starts.
    clicks(db, id, TODAY_CLICKS, ago(0, 1));
    clicks(db, id, YESTERDAY_CLICKS, ago(1));
    clicks(db, id, 1, ago(OLD_CLICK_DAYS));

    const res = await api.get('/api/links/abc1234');

    // The total counts every click, even the old one the chart leaves out.
    expect(res.body.totalClicks).toBe(TODAY_CLICKS + YESTERDAY_CLICKS + 1);
    // The latest click was an hour before NOW.
    expect(res.body.lastClickAt).toBe('2026-11-22 11:00:00');
    // The chart's last two days hold today's and yesterday's clicks.
    expect(res.body.daily[TODAY_INDEX]).toEqual({ day: '2026-11-22', clicks: TODAY_CLICKS });
    expect(res.body.daily[YESTERDAY_INDEX]).toEqual({ day: '2026-11-21', clicks: YESTERDAY_CLICKS });
    // The chart adds up to the clicks within it: the old click is not in any slot.
    const charted = res.body.daily.reduce((sum: number, entry: { clicks: number }) => sum + entry.clicks, 0);
    expect(charted).toBe(TODAY_CLICKS + YESTERDAY_CLICKS);
  });

  it('includes a click at midnight on the oldest chart day', async () => {
    const { api, db } = makeApp();
    const id = insertLinkRow(db, 'abc1234', GOOD_URL);
    // 00:00:00 UTC on 24 October, the first moment the chart covers.
    insertClick(db, id, new Date('2026-10-24T00:00:00Z'));
    // One second earlier, the last moment it does not.
    insertClick(db, id, new Date('2026-10-23T23:59:59Z'));

    const res = await api.get('/api/links/abc1234');

    expect(res.body.daily.at(0)).toEqual({ day: '2026-10-24', clicks: 1 });
  });

  it('lists the top referrers, most clicks first, with direct visits as (direct)', async () => {
    const { api, db } = makeApp();
    const id = insertLinkRow(db, 'abc1234', GOOD_URL);
    // Three from Hacker News, two direct, one from Reddit.
    clicks(db, id, TODAY_CLICKS, ago(0, 1), 'news.ycombinator.com');
    clicks(db, id, YESTERDAY_CLICKS, ago(0, 1));
    clicks(db, id, 1, ago(0, 1), 'www.reddit.com');

    const res = await api.get('/api/links/abc1234');

    expect(res.body.referrers).toEqual([
      { host: 'news.ycombinator.com', clicks: TODAY_CLICKS },
      { host: '(direct)', clicks: YESTERDAY_CLICKS },
      { host: 'www.reddit.com', clicks: 1 },
    ]);
  });

  it('shows at most 5 referrers, ties sorted by name', async () => {
    const { api, db } = makeApp();
    const id = insertLinkRow(db, 'abc1234', GOOD_URL);
    // Seven sites with one click each: site-1.com to site-7.com.
    Array.from({ length: REFERRER_COUNT }, (_, i) => insertClick(db, id, ago(0, 1), `site-${i + 1}.com`));

    const res = await api.get('/api/links/abc1234');

    // Only five, and with every count equal they come in name order.
    expect(res.body.referrers.map((entry: { host: string }) => entry.host)).toEqual([
      'site-1.com',
      'site-2.com',
      'site-3.com',
      'site-4.com',
      'site-5.com',
    ]);
  });

  it('counts the clicks the redirect records', async () => {
    // The whole path through the API: create, visit twice, read the stats.
    const { api } = makeApp();
    const created = await api.post('/api/links').send({ url: GOOD_URL, alias: 'gym-plan' });
    await api.get(`/${created.body.code}`).set('Referer', 'https://www.google.com/search?q=gym');
    await api.get(`/${created.body.code}`);

    const res = await api.get('/api/links/gym-plan');

    expect(res.body.totalClicks).toBe(VISITS);
    expect(res.body.referrers).toEqual([
      { host: '(direct)', clicks: 1 },
      { host: 'www.google.com', clicks: 1 },
    ]);
  });
});
