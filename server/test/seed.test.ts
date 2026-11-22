// The sample links the demo starts with.

// describe groups tests, it is one test, expect checks a value.
import { describe, expect, it } from 'vitest';
// The seeder, and the click curve it uses.
import { sampleClicks, seedIfEmpty } from '../src/seed.ts';
// A fresh app, the fixed clock, a direct insert, and status codes by name.
import { FOUND, GONE, GOOD_URL, insertLinkRow, makeApp, NOW, OK } from './helpers.ts';
// The chart's span.
import { STATS_DAYS } from '../src/links.ts';

// The alias and the expired link the seed promises.
const ALIAS = 'mdn-fetch';
const EXPIRED = 'old-promo';
// A chart "with a shape" has clicks on at least this many of its days.
const MIN_BUSY_DAYS = 15;

describe('seedIfEmpty', () => {
  it('adds the samples to an empty database, once', () => {
    const { db } = makeApp();

    // The first run adds links; the second finds them and adds none.
    expect(seedIfEmpty(db, NOW)).toBeGreaterThan(0);
    expect(seedIfEmpty(db, NOW)).toBe(0);
  });

  it('leaves a database that already has links alone', () => {
    const { db } = makeApp();
    insertLinkRow(db, 'mine', GOOD_URL);

    // Nothing added on top of the existing link.
    expect(seedIfEmpty(db, NOW)).toBe(0);
  });

  it('includes a working alias with clicks spread over the chart', async () => {
    const { api, db } = makeApp();
    seedIfEmpty(db, NOW);

    // The alias redirects.
    const visit = await api.get(`/${ALIAS}`);
    expect(visit.status).toBe(FOUND);

    // Its stats have clicks on many different days.
    const stats = await api.get(`/api/links/${ALIAS}`);
    expect(stats.status).toBe(OK);
    const busyDays = stats.body.daily.filter((day: { clicks: number }) => day.clicks > 0);
    expect(busyDays.length).toBeGreaterThanOrEqual(MIN_BUSY_DAYS);
    // And at least one named referrer.
    expect(stats.body.referrers.length).toBeGreaterThan(0);
  });

  it('includes an expired link', async () => {
    const { api, db } = makeApp();
    seedIfEmpty(db, NOW);

    // 410 "gone" for a link past its expiry.
    const res = await api.get(`/${EXPIRED}`);
    expect(res.status).toBe(GONE);
  });
});

describe('sampleClicks', () => {
  it('never goes below zero', () => {
    // One value per chart day for a busy link.
    const counts = Array.from({ length: STATS_DAYS }, (_, daysAgo) => sampleClicks(daysAgo, STATS_DAYS));

    // Every count is a whole number of 0 or more.
    expect(counts.every((count) => Number.isInteger(count) && count >= 0)).toBe(true);
  });
});
