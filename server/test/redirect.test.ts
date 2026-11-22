// GET /:code: the redirect, the 404 and 410 pages, and the click it records.

import { describe, expect, it } from 'vitest';
// Referrer parsing on its own.
import { referrerHost } from '../src/redirect.ts';
import { FOUND, GONE, GOOD_URL, insertLinkRow, makeApp, NOT_FOUND, NOW } from './helpers.ts';

// An hour, for expiry dates relative to NOW.
const HOUR_MS = 3_600_000;

// The stored clicks for one link, oldest first, as the tests want to see them.
function clicksFor(db: ReturnType<typeof makeApp>['db'], linkId: number) {
  // Only the columns the redirect fills in.
  return db.prepare('SELECT clicked_at, referrer_host FROM clicks WHERE link_id = ? ORDER BY id').all(linkId);
}

describe('following a short link', () => {
  it('redirects with 302 to the long URL and is never cached', async () => {
    const { api, db } = makeApp();
    insertLinkRow(db, 'abc1234', GOOD_URL);

    const res = await api.get('/abc1234');

    // 302 "found", pointing at the stored URL.
    expect(res.status).toBe(FOUND);
    expect(res.headers.location).toBe(GOOD_URL);
    // no-store stops the browser keeping the redirect, so the next visit is counted too.
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('records one click per visit, at the current time', async () => {
    const { api, db } = makeApp();
    const id = insertLinkRow(db, 'abc1234', GOOD_URL);

    // Two visits, one after the other.
    await api.get('/abc1234');
    await api.get('/abc1234');

    // Two rows, both stamped with the fixed test clock, both direct.
    expect(clicksFor(db, id)).toEqual([
      { clicked_at: '2026-11-22 12:00:00', referrer_host: null },
      { clicked_at: '2026-11-22 12:00:00', referrer_host: null },
    ]);
  });

  it('keeps only the host of the referring page', async () => {
    const { api, db } = makeApp();
    const id = insertLinkRow(db, 'abc1234', GOOD_URL);

    // A full referrer address with a path and query, which must not be stored.
    await api.get('/abc1234').set('Referer', 'https://news.ycombinator.com/item?id=12345');

    expect(clicksFor(db, id)).toEqual([{ clicked_at: '2026-11-22 12:00:00', referrer_host: 'news.ycombinator.com' }]);
  });

  it('does not count a HEAD request as a visit', async () => {
    const { api, db } = makeApp();
    const id = insertLinkRow(db, 'abc1234', GOOD_URL);

    // HEAD asks for the headers only, as link checkers do.
    const res = await api.head('/abc1234');

    // Same redirect answer, but no click.
    expect(res.status).toBe(FOUND);
    expect(clicksFor(db, id)).toEqual([]);
  });

  it('treats codes as case-sensitive', async () => {
    const { api, db } = makeApp();
    insertLinkRow(db, 'abc1234', GOOD_URL);

    // Upper-case ABC is a different code, and there is no such link.
    const res = await api.get('/ABC1234');

    expect(res.status).toBe(NOT_FOUND);
  });
});

describe('links that do not work', () => {
  it('answers an unknown code with a 404 HTML page', async () => {
    const res = await makeApp().api.get('/nothere');

    // A page for a person, not JSON, and not cached either.
    expect(res.status).toBe(NOT_FOUND);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Link not found');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 404 for a path that cannot be a code, without a lookup', async () => {
    // A dot is never part of a code, so this is turned away before the database is asked.
    const res = await makeApp().api.get('/favicon.ico');

    expect(res.status).toBe(NOT_FOUND);
  });

  it('answers an expired link with a 410 page and records no click', async () => {
    const { api, db } = makeApp();
    // The link expired an hour before the test clock's NOW.
    const id = insertLinkRow(db, 'old1234', GOOD_URL, new Date(NOW.getTime() - HOUR_MS));

    const res = await api.get('/old1234');

    // 410 "gone": the link existed and has ended.
    expect(res.status).toBe(GONE);
    expect(res.text).toContain('Link expired');
    expect(clicksFor(db, id)).toEqual([]);
  });

  it('still redirects a link whose expiry is in the future', async () => {
    const { api, db } = makeApp();
    // Expires an hour after NOW.
    insertLinkRow(db, 'new1234', GOOD_URL, new Date(NOW.getTime() + HOUR_MS));

    const res = await api.get('/new1234');

    expect(res.status).toBe(FOUND);
  });

  it('stops working at the exact moment of expiry', async () => {
    const { api, db } = makeApp();
    // Expires at NOW itself: the last valid moment has passed.
    insertLinkRow(db, 'end1234', GOOD_URL, NOW);

    const res = await api.get('/end1234');

    expect(res.status).toBe(GONE);
  });
});

describe('referrerHost', () => {
  it.each([
    ['https://news.ycombinator.com/item?id=1', 'news.ycombinator.com'],
    ['http://localhost:5173/stats/abc', 'localhost'],
    [undefined, null],
    ['not a url', null],
    ['file:///C:/notes.html', null],
  ])('turns %s into %s', (referer, expected) => {
    // Only the host survives; anything unusable counts as a direct visit.
    expect(referrerHost(referer)).toBe(expected);
  });
});
