// The security headers on every kind of answer, and the limit on stats lookups.

// Vitest's test functions.
import { describe, expect, it } from 'vitest';
// A fresh app per test, a way to add a link directly, and the status codes by name.
import { FOUND, GOOD_URL, insertLinkRow, makeApp, NOT_FOUND, OK, TOO_MANY_REQUESTS } from './helpers.ts';

// A short code that exists in the tests that add one.
const CODE = 'abc1234';
// A lookup limit small enough to reach in a test: two lookups pass, the third is refused.
const LOW_LIMIT = 2;

describe('security headers', () => {
  it('sends a Content-Security-Policy and the other helmet headers on API answers', async () => {
    const { api } = makeApp();
    // Any API answer will do; a missing link is the simplest.
    const res = await api.get('/api/links/nothere');
    // The policy lets scripts come only from this site.
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    // Stops the browser guessing a content type other than the one sent.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // Stops another site showing this one inside a frame.
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    // Express's "X-Powered-By: Express" is removed, so the stack is not advertised.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sends the policy on the HTML 404 page too', async () => {
    const { api } = makeApp();
    // A path with a dot can never be a code, so it reaches the 404 page.
    const res = await api.get('/no/such.page');
    expect(res.status).toBe(NOT_FOUND);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('sends no referrer on redirects, so the target does not learn the short link', async () => {
    const { api, db } = makeApp();
    // A link to follow.
    insertLinkRow(db, CODE, GOOD_URL);
    const res = await api.get(`/${CODE}`);
    // The redirect itself still works.
    expect(res.status).toBe(FOUND);
    // The browser is told to send no Referer header when it follows the redirect.
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('stats lookup limit', () => {
  it('answers 429 in JSON once one visitor passes the limit', async () => {
    const { api, db } = makeApp({ lookupLimit: LOW_LIMIT });
    // A link whose stats are looked up.
    insertLinkRow(db, CODE, GOOD_URL);
    // The first two lookups are within the limit.
    expect((await api.get(`/api/links/${CODE}`)).status).toBe(OK);
    expect((await api.get(`/api/links/${CODE}`)).status).toBe(OK);
    // The third is refused, in the API's usual error shape.
    const res = await api.get(`/api/links/${CODE}`);
    expect(res.status).toBe(TOO_MANY_REQUESTS);
    expect(res.body).toEqual({ error: 'Too many lookups; try again in a minute' });
    // The RateLimit header tells a client when it may try again.
    expect(res.headers['ratelimit']).toBeDefined();
  });

  it('counts missing codes too, so guessing codes uses up the limit', async () => {
    const { api } = makeApp({ lookupLimit: LOW_LIMIT });
    // Two guesses that find nothing still count.
    expect((await api.get('/api/links/guess01')).status).toBe(NOT_FOUND);
    expect((await api.get('/api/links/guess02')).status).toBe(NOT_FOUND);
    // The third guess is refused before the database is asked.
    expect((await api.get('/api/links/guess03')).status).toBe(TOO_MANY_REQUESTS);
  });

  it('does not slow down redirects, which have no lookup limit', async () => {
    const { api, db } = makeApp({ lookupLimit: LOW_LIMIT });
    // A link to follow several times.
    insertLinkRow(db, CODE, GOOD_URL);
    // Use up the lookup limit first.
    await api.get(`/api/links/${CODE}`);
    await api.get(`/api/links/${CODE}`);
    await api.get(`/api/links/${CODE}`);
    // Visitors following the short link are unaffected.
    expect((await api.get(`/${CODE}`)).status).toBe(FOUND);
  });
});
