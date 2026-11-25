// The Safe Browsing check on its own (with a fake fetch), and how the app uses it when a
// link is created or followed.

import { describe, expect, it, vi } from 'vitest';
import {
  CACHE_MAX_ENTRIES,
  createSafeBrowsingChecker,
  MIN_SAFE_CACHE_MS,
  type UrlChecker,
} from '../src/safeBrowsing.ts';
import { CHECK_UNAVAILABLE } from '../src/routes.ts';
import { BAD_REQUEST, CREATED, FOUND, GONE, GOOD_URL, insertLinkRow, makeApp, NOW } from './helpers.ts';

// 503 "service unavailable": the answer when the check cannot run.
const SERVICE_UNAVAILABLE = 503;
// A link the stand-in checker cannot reach Google for.
const UNREACHABLE_URL = 'https://slow.example.org/page';

// A link the fake Google lists as phishing.
const BAD_URL = 'https://phish.example.net/login';
// The status Google answers with when the key is refused.
const FORBIDDEN = 403;
// A second's worth of milliseconds, for moving the fake clock.
const SECOND_MS = 1_000;
// Google's usual cache time for an answer, as it sends it: five minutes, in seconds.
const SERVER_CACHE_SECONDS = 300;
const SERVER_CACHE_MS = 300_000;
// Two calls, or two steps of the clock.
const TWICE = 2;
// Protobuf encoding: each field key is its number times 8, plus its wire type.
const FIELD_KEY_SHIFT = 8;
const WIRE_VARINT = 0;
const WIRE_LENGTH = 2;
// Varint bytes hold seven bits each; 128 is the top bit that says another byte follows.
const VARINT_STEP = 128;
const VARINT_MORE = 128;
// The field numbers the checker reads.
const THREATS_FIELD = 1;
const DURATION_FIELD = 2;
const SECONDS_FIELD = 1;
const ERROR_MESSAGE_FIELD = 2;
// The status Google sends with a refused key's reply.
const PROTO_BAD_REQUEST = 3;

// A varint: seven bits per byte, lowest first, with the top bit set while more bytes follow.
function varint(value: number): number[] {
  // The low seven bits of the value, and the rest.
  const low = value % VARINT_STEP;
  const rest = Math.floor(value / VARINT_STEP);
  return rest === 0 ? [low] : [low | VARINT_MORE, ...varint(rest)];
}

// A field holding a number.
const numberField = (number: number, value: number): number[] => [
  ...varint(number * FIELD_KEY_SHIFT + WIRE_VARINT),
  ...varint(value),
];

// A field holding bytes: text or a nested message.
const bytesField = (number: number, payload: number[]): number[] => [
  ...varint(number * FIELD_KEY_SHIFT + WIRE_LENGTH),
  ...varint(payload.length),
  ...payload,
];

// The bytes of a text.
const textBytes = (text: string): number[] => [...new TextEncoder().encode(text)];

// Google's reply to a search: a threat entry (when the link is listed) and the cache time.
function searchReply(listed: boolean, seconds: number): ArrayBuffer {
  // One threat entry: the URL in its field 1.
  const threat = listed ? bytesField(THREATS_FIELD, bytesField(1, textBytes(BAD_URL))) : [];
  // The cache time, a Duration with its seconds.
  const duration = bytesField(DURATION_FIELD, numberField(SECONDS_FIELD, seconds));
  return Uint8Array.from([...threat, ...duration]).buffer as ArrayBuffer;
}

// A fake fetch that answers like Google: BAD_URL is a threat, everything else is clean.
function fakeGoogle() {
  return vi.fn(async (input: string | URL | Request) => {
    // The link sent is in the `urls` query parameter.
    const sent = new URL(String(input)).searchParams.get('urls');
    return new Response(searchReply(sent === BAD_URL, SERVER_CACHE_SECONDS), {
      headers: { 'Content-Type': 'application/x-protobuf' },
    });
  });
}

// A checker over the fake, with a clock the test can move.
function makeChecker(fetchImpl: typeof fetch) {
  const clock = { time: NOW.getTime() };
  const log = vi.fn();
  const check = createSafeBrowsingChecker({ apiKey: 'test-key', fetch: fetchImpl, now: () => new Date(clock.time), log });
  return { check, clock, log };
}

describe('the Safe Browsing checker', () => {
  it('reports listed links as unsafe and others as safe', async () => {
    const { check } = makeChecker(fakeGoogle());

    expect(await check(BAD_URL)).toBe('unsafe');
    expect(await check(GOOD_URL)).toBe('safe');
  });

  it('sends the key in a header, never in the address', async () => {
    const google = fakeGoogle();
    const { check } = makeChecker(google);

    await check(GOOD_URL);

    // The first call's address and options.
    const [address, init] = google.mock.calls[0] as unknown as [string, RequestInit];
    expect(address).not.toContain('test-key');
    // No alt parameter: Google's default binary reply is the one that works.
    expect(new URL(address).searchParams.has('alt')).toBe(false);
    expect(new Headers(init.headers).get('X-Goog-Api-Key')).toBe('test-key');
  });

  it('keeps a clean answer for at least an hour', async () => {
    const google = fakeGoogle();
    const { check, clock } = makeChecker(google);

    await check(GOOD_URL);
    // Just under an hour later: still cached, although Google only allowed five minutes.
    clock.time += MIN_SAFE_CACHE_MS - SECOND_MS;
    await check(GOOD_URL);
    expect(google).toHaveBeenCalledTimes(1);

    // Past the hour: asked again.
    clock.time += SECOND_MS * TWICE;
    await check(GOOD_URL);
    expect(google).toHaveBeenCalledTimes(TWICE);
  });

  it('keeps an unsafe answer only as long as Google says', async () => {
    const google = fakeGoogle();
    const { check, clock } = makeChecker(google);

    await check(BAD_URL);
    // Past the five minutes: asked again, in case the site was cleaned up.
    clock.time += SERVER_CACHE_MS + SECOND_MS;
    await check(BAD_URL);
    expect(google).toHaveBeenCalledTimes(TWICE);
  });

  it("logs Google's own reason for a refusal", async () => {
    // Google's binary error reply for a bad key: a status code, then the message.
    const reply = Uint8Array.from([
      ...numberField(1, PROTO_BAD_REQUEST),
      ...bytesField(ERROR_MESSAGE_FIELD, textBytes('API key not valid. Please pass a valid API key.')),
    ]);
    const refusing = vi.fn(async () => new Response(reply, { status: BAD_REQUEST }));
    const { check, log } = makeChecker(refusing);

    expect(await check(BAD_URL)).toBe('unavailable');
    expect(log).toHaveBeenCalledWith('Safe Browsing check failed: Safe Browsing answered 400: API key not valid. Please pass a valid API key.');
  });

  it('answers unavailable and logs when Google refuses, and does not cache the failure', async () => {
    const refusing = vi.fn(async () => new Response('denied', { status: FORBIDDEN }));
    const { check, log } = makeChecker(refusing);

    expect(await check(BAD_URL)).toBe('unavailable');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('403'));
    // Asked again next time, since nothing was cached.
    await check(BAD_URL);
    expect(refusing).toHaveBeenCalledTimes(TWICE);
  });

  it('answers unavailable when the network fails', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const { check, log } = makeChecker(offline);

    expect(await check(BAD_URL)).toBe('unavailable');
    expect(log).toHaveBeenCalledOnce();
  });

  it('drops the oldest answer once the cache is full', async () => {
    const google = fakeGoogle();
    const { check } = makeChecker(google);
    // Fills the cache exactly, with distinct links.
    const links = Array.from({ length: CACHE_MAX_ENTRIES }, (_, index) => `https://site${index}.example.com/`);
    await Promise.all(links.map((link) => check(link)));

    // One more link pushes out the first.
    await check('https://one-more.example.com/');
    await check(links[0] ?? '');
    // Every link once, the extra one, and the first again.
    expect(google).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + TWICE);
  });
});

// A stand-in checker for the app tests: BAD_URL is unsafe, UNREACHABLE_URL cannot be checked.
const flagBad: UrlChecker = async (url) => {
  if (url === BAD_URL) return 'unsafe';
  return url === UNREACHABLE_URL ? 'unavailable' : 'safe';
};

describe('the app with Safe Browsing', () => {
  it('refuses to shorten a listed link', async () => {
    const { api } = makeApp({ checkUrl: flagBad });

    const res = await api.post('/api/links').send({ url: BAD_URL });

    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.issues).toEqual([{ field: 'url', message: 'Google Safe Browsing lists this link as unsafe' }]);
  });

  it('still shortens a clean link', async () => {
    const { api } = makeApp({ checkUrl: flagBad });

    const res = await api.post('/api/links').send({ url: GOOD_URL });

    expect(res.status).toBe(CREATED);
  });

  it('blocks a link that turned bad after it was made, without counting a visit', async () => {
    const { api, db } = makeApp({ checkUrl: flagBad });
    // Stored directly, as if it had been clean when it was created.
    const id = insertLinkRow(db, 'abc1234', BAD_URL);

    const res = await api.get('/abc1234');

    expect(res.status).toBe(GONE);
    expect(res.headers.location).toBeUndefined();
    // The page does not repeat the bad address.
    expect(res.text).not.toContain(BAD_URL);
    expect(db.prepare('SELECT COUNT(*) AS n FROM clicks WHERE link_id = ?').get(id)).toEqual({ n: 0 });
  });

  it('refuses to shorten a link it could not check, with 503 and the banner message', async () => {
    const { api, db } = makeApp({ checkUrl: flagBad });

    const res = await api.post('/api/links').send({ url: UNREACHABLE_URL });

    expect(res.status).toBe(SERVICE_UNAVAILABLE);
    expect(res.body).toEqual({ error: CHECK_UNAVAILABLE });
    expect(res.headers['retry-after']).toBeDefined();
    // Nothing was stored.
    expect(db.prepare('SELECT COUNT(*) AS n FROM links').get()).toEqual({ n: 0 });
  });

  it('still redirects an existing link while the check is unavailable', async () => {
    const { api, db } = makeApp({ checkUrl: flagBad });
    insertLinkRow(db, 'abc1234', UNREACHABLE_URL);

    const res = await api.get('/abc1234');

    expect(res.status).toBe(FOUND);
    expect(res.headers.location).toBe(UNREACHABLE_URL);
  });

  it('follows clean links as before', async () => {
    const { api, db } = makeApp({ checkUrl: flagBad });
    insertLinkRow(db, 'abc1234', GOOD_URL);

    const res = await api.get('/abc1234');

    expect(res.status).toBe(FOUND);
  });
});
