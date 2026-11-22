// POST /api/links: creating links with random codes and aliases, and every way it can refuse.

// vi makes fake functions; the rest structure and check the tests.
import { describe, expect, it, vi } from 'vitest';
// The default limit, to know how many creates are allowed.
import { DEFAULT_CREATE_LIMIT } from '../src/app.ts';
// The rules the responses should follow.
import { ALIAS_MAX, CODE_LENGTH } from '../src/codes.ts';
// How many draws a clash may take before the server gives up.
import { MAX_CODE_ATTEMPTS } from '../src/routes.ts';
import {
  BAD_REQUEST,
  CONFLICT,
  CREATED,
  GOOD_URL,
  insertLinkRow,
  makeApp,
  NOW,
  SERVER_ERROR,
  TOO_MANY_REQUESTS,
} from './helpers.ts';

// Characters of path to put in a URL so it goes past the 2,048-character limit.
const LONG_PATH_LENGTH = 3000;
// A URL longer than the limit.
const TOO_LONG_URL = `https://example.com/${'a'.repeat(LONG_PATH_LENGTH)}`;
// Two taken codes and then a free one: three draws.
const DRAWS_TO_FREE_CODE = 3;
// An hour, for expiry dates relative to NOW.
const HOUR_MS = 3_600_000;

describe('creating a link with a random code', () => {
  it('returns 201 with a 7-character code and the stored fields', async () => {
    const res = await makeApp().api.post('/api/links').send({ url: GOOD_URL });

    // "Created", with the link as JSON.
    expect(res.status).toBe(CREATED);
    expect(res.body.code).toHaveLength(CODE_LENGTH);
    // The URL comes back unchanged, stamped with the fixed test clock and no expiry.
    expect(res.body).toMatchObject({ url: GOOD_URL, createdAt: '2026-11-22 12:00:00', expiresAt: null });
  });

  it('gives two links two different codes', async () => {
    // Same app, so the second link must avoid the first one's code.
    const { api } = makeApp();
    const first = await api.post('/api/links').send({ url: GOOD_URL });
    const second = await api.post('/api/links').send({ url: GOOD_URL });

    expect(first.body.code).not.toBe(second.body.code);
  });

  it('stores an expiry given with an offset as UTC', async () => {
    // 09:00 at UTC-5 is 14:00 UTC, two hours after NOW.
    const res = await makeApp().api.post('/api/links').send({ url: GOOD_URL, expiresAt: '2026-11-22T09:00:00-05:00' });

    expect(res.status).toBe(CREATED);
    expect(res.body.expiresAt).toBe('2026-11-22 14:00:00');
  });
});

describe('refusing bad input', () => {
  it.each([
    ['an ftp link', 'ftp://example.com/file'],
    ['a javascript: link', 'javascript:alert(1)'],
    ['a data: link', 'data:text/html,<script>alert(1)</script>'],
    ['localhost', 'http://localhost:3000/'],
    ['a bare IP address', 'http://192.168.1.1/admin'],
    ['text that is not a link', 'not a link'],
    ['a link over 2,048 characters', TOO_LONG_URL],
  ])('answers 400 for %s', async (_label, url) => {
    const res = await makeApp().api.post('/api/links').send({ url });

    // "Bad request", with the problem tied to the url field.
    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.issues).toEqual([expect.objectContaining({ field: 'url' })]);
  });

  it('answers 400 for an empty body', async () => {
    const res = await makeApp().api.post('/api/links').send({});

    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.issues).toEqual([expect.objectContaining({ field: 'url' })]);
  });

  it('answers 400 for a link back to the shortener itself', async () => {
    // Supertest lets a test pretend the request arrived at sho.rt.
    const res = await makeApp().api.post('/api/links').set('Host', 'sho.rt').send({ url: 'https://sho.rt/abc1234' });

    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.issues).toEqual([{ field: 'url', message: 'That is already a short link' }]);
  });

  it('answers 400 for an expiry in the past', async () => {
    // One hour before the test clock's NOW.
    const expiresAt = new Date(NOW.getTime() - HOUR_MS).toISOString();
    const res = await makeApp().api.post('/api/links').send({ url: GOOD_URL, expiresAt });

    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.issues).toEqual([{ field: 'expiresAt', message: 'The expiry must be in the future' }]);
  });

  it('answers 400 for an expiry that is not a date', async () => {
    const res = await makeApp().api.post('/api/links').send({ url: GOOD_URL, expiresAt: 'next tuesday' });

    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.issues).toEqual([expect.objectContaining({ field: 'expiresAt' })]);
  });
});

describe('custom aliases', () => {
  it('uses the alias as the code', async () => {
    const res = await makeApp().api.post('/api/links').send({ url: GOOD_URL, alias: 'gym-plan' });

    expect(res.status).toBe(CREATED);
    expect(res.body.code).toBe('gym-plan');
  });

  it('answers 409 when the alias is taken', async () => {
    // The first request takes the alias; the second asks for it again.
    const { api } = makeApp();
    await api.post('/api/links').send({ url: GOOD_URL, alias: 'gym-plan' });
    const res = await api.post('/api/links').send({ url: 'https://example.org/', alias: 'gym-plan' });

    // "Conflict", with the message under the alias field.
    expect(res.status).toBe(CONFLICT);
    expect(res.body.issues).toEqual([{ field: 'alias', message: 'That alias is already taken' }]);
  });

  it('treats aliases as case-sensitive', async () => {
    // Gym-Plan and gym-plan are different codes, so both can exist.
    const { api } = makeApp();
    await api.post('/api/links').send({ url: GOOD_URL, alias: 'gym-plan' });
    const res = await api.post('/api/links').send({ url: GOOD_URL, alias: 'Gym-Plan' });

    expect(res.status).toBe(CREATED);
  });

  it.each(['api', 'Stats', 'ab', 'has space', 'a.b', 'a'.repeat(ALIAS_MAX + 1)])('answers 400 for "%s"', async (alias) => {
    const res = await makeApp().api.post('/api/links').send({ url: GOOD_URL, alias });

    // Reserved, too short, too long, or a character that is not allowed.
    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.issues).toEqual([expect.objectContaining({ field: 'alias' })]);
  });
});

describe('code collisions', () => {
  it('draws again when a random code is taken', async () => {
    // A fake generator: the first two draws return a code already in use, the third a free one.
    const generateCode = vi.fn().mockReturnValueOnce('taken01').mockReturnValueOnce('taken01').mockReturnValueOnce('fresh01');
    const { api, db } = makeApp({ generateCode });
    insertLinkRow(db, 'taken01', 'https://example.org/');

    const res = await api.post('/api/links').send({ url: GOOD_URL });

    // The third code was used, after exactly three draws.
    expect(res.status).toBe(CREATED);
    expect(res.body.code).toBe('fresh01');
    expect(generateCode).toHaveBeenCalledTimes(DRAWS_TO_FREE_CODE);
  });

  it('skips a random code that is a reserved word', async () => {
    // "favicon" happens to be 7 letters long, so the generator could in theory draw it.
    const generateCode = vi.fn().mockReturnValueOnce('favicon').mockReturnValueOnce('fresh01');
    const res = await makeApp({ generateCode }).api.post('/api/links').send({ url: GOOD_URL });

    expect(res.body.code).toBe('fresh01');
  });

  it('gives up with a 500 after five clashes in a row', async () => {
    // Every draw returns the same taken code. console.error is silenced so the expected
    // server error does not clutter the test output.
    const generateCode = vi.fn(() => 'taken01');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, db } = makeApp({ generateCode });
    insertLinkRow(db, 'taken01', 'https://example.org/');

    const res = await api.post('/api/links').send({ url: GOOD_URL });

    // A generic 500, after exactly the allowed number of attempts.
    expect(res.status).toBe(SERVER_ERROR);
    expect(res.body).toEqual({ error: 'Something went wrong' });
    expect(generateCode).toHaveBeenCalledTimes(MAX_CODE_ATTEMPTS);
    // Puts console.error back for the other tests.
    quiet.mockRestore();
  });
});

describe('rate limit', () => {
  it('answers 429 once a visitor has created 20 links in a minute', async () => {
    // One app, so all requests share one limiter. The allowed creates run one after another.
    const { api } = makeApp();
    const allowed = Array.from({ length: DEFAULT_CREATE_LIMIT }, () => GOOD_URL);
    // reduce chains the requests so each starts after the previous one finishes.
    await allowed.reduce(async (previous, url) => {
      await previous;
      const res = await api.post('/api/links').send({ url });
      expect(res.status).toBe(CREATED);
    }, Promise.resolve());

    // The 21st is refused, in the API's usual error shape.
    const res = await api.post('/api/links').send({ url: GOOD_URL });
    expect(res.status).toBe(TOO_MANY_REQUESTS);
    expect(res.body).toEqual({ error: 'Too many new links; try again in a minute' });
  });

  it('counts by the visitor behind the three proxies, not by a proxy or a forged header', async () => {
    // On Render the header reads "anything the visitor sent, visitor, Cloudflare server,
    // internal balancer", and the local proxy is the connection itself (here, Supertest on
    // 127.0.0.1).
    const { api } = makeApp({ createLimit: 1 });
    const first = await api
      .post('/api/links')
      .set('X-Forwarded-For', '9.9.9.1, 203.0.113.7, 104.16.0.1, 10.0.0.1')
      .send({ url: GOOD_URL });
    expect(first.status).toBe(CREATED);

    // Same visitor, a different forged prefix and different proxies: still one counter, so
    // the limit of 1 is already used up.
    const second = await api
      .post('/api/links')
      .set('X-Forwarded-For', '9.9.9.2, 203.0.113.7, 104.16.0.2, 10.0.0.2')
      .send({ url: GOOD_URL });
    expect(second.status).toBe(TOO_MANY_REQUESTS);
  });

  it('counts each app separately', async () => {
    // A limit of 1 in a fresh app: the first create works even though the test above used up
    // its own app's limit, which shows tests cannot affect each other.
    const res = await makeApp({ createLimit: 1 }).api.post('/api/links').send({ url: GOOD_URL });

    expect(res.status).toBe(CREATED);
  });
});
