// Asks Google Safe Browsing whether a link leads to a phishing, malware or unwanted-software
// page, so the shortener cannot be used to hide one behind a harmless-looking short link.
//
// It uses the v5 Lookup API (GET /v5/urls:search). v4 is retired on 31 March 2027.
// Answers are cached, as the API's terms require, so a popular link costs one call an hour
// rather than one per visit. When Google cannot be reached the answer is "unavailable" and
// the failure is logged. Each caller decides what that means: creating a link refuses it
// (nothing unchecked gets shortened), while following an existing link still redirects (it
// was checked when it was made, and an outage should not break every short link).

// The address of the lookup. `urls` is the query parameter holding the link to check.
const SEARCH_URL = 'https://safebrowsing.googleapis.com/v5/urls:search';

// How long one lookup may take before it counts as unavailable. Creating a link waits for
// this, so it is kept short.
export const LOOKUP_TIMEOUT_MS = 2_000;
// A clean answer is kept at least an hour. The API allows stretching a clean answer's cache
// time, up to a day.
export const MIN_SAFE_CACHE_MS = 3_600_000;
// The longest the API lets a clean answer be kept: 24 hours.
export const MAX_SAFE_CACHE_MS = 86_400_000;
// The most answers kept at once. When full, the oldest is dropped, so memory stays bounded
// however many different links people create or visit.
export const CACHE_MAX_ENTRIES = 1_000;
// Seconds to milliseconds.
const MS_PER_SECOND = 1_000;

// The outcome of one check: listed as unsafe, not listed, or Google could not be asked.
export type Verdict = 'safe' | 'unsafe' | 'unavailable';

// Checks one link. Never rejects: a failed lookup resolves to 'unavailable'.
export type UrlChecker = (url: string) => Promise<Verdict>;

// The part of Google's answer used here. `threats` is missing or empty for a clean link.
// `cacheDuration` is text such as "300s": how long the answer may be reused.
interface SearchResponse {
  threats?: { url: string; threatTypes: string[] }[];
  cacheDuration?: string;
}

// What the checker needs. Only the key is required; the rest exist so tests can swap them.
export interface SafeBrowsingOptions {
  apiKey: string;
  fetch?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
}

// One cached answer and the moment it stops being valid.
interface CacheEntry {
  unsafe: boolean;
  expiresAt: number;
}

// A checker for when no API key is set (development, tests): every link counts as safe.
export const allowAll: UrlChecker = async () => 'safe';

// A cached answer as a verdict.
const verdictOf = (unsafe: boolean): Verdict => (unsafe ? 'unsafe' : 'safe');

// "300s" or "3.5s" in milliseconds. parseFloat reads the number and stops at the "s".
// Missing or unreadable text counts as zero, so the minimums below apply.
function durationMs(text: string | undefined): number {
  const seconds = Number.parseFloat(text ?? '');
  return Number.isFinite(seconds) ? seconds * MS_PER_SECOND : 0;
}

// How long an answer may be kept. An unsafe answer keeps exactly what Google said. A clean
// one keeps at least an hour, and never more than the day the API allows.
function cacheMs(unsafe: boolean, serverMs: number): number {
  if (unsafe) return serverMs;
  return Math.min(Math.max(serverMs, MIN_SAFE_CACHE_MS), MAX_SAFE_CACHE_MS);
}

// Builds a checker that calls Google with the given key.
export function createSafeBrowsingChecker(options: SafeBrowsingOptions): UrlChecker {
  // The real fetch, clock and console unless a test passed its own.
  const settings = { fetch: globalThis.fetch, now: () => new Date(), log: console.error, ...options };
  // Answers by link. A Map remembers insertion order, so its first key is the oldest.
  const cache = new Map<string, CacheEntry>();

  // Stores one answer, dropping the oldest first when the cache is full.
  function remember(url: string, entry: CacheEntry): void {
    // Re-adding a key moves it to the end, so it counts as newest.
    cache.delete(url);
    if (cache.size >= CACHE_MAX_ENTRIES) {
      // keys().next() gives the oldest key; `value` is undefined only for an empty map.
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(url, entry);
  }

  // Asks Google, and returns the answer with how long it may be kept.
  async function lookup(url: string): Promise<CacheEntry> {
    // URLSearchParams escapes the link, so its own ? and & cannot break the query.
    // alt=json asks for JSON: v5 answers in binary protobuf by default, which res.json() cannot
    // read (it failed in production with "Unexpected non-whitespace character after JSON").
    const query = new URLSearchParams({ urls: url, alt: 'json' });
    const res = await settings.fetch(`${SEARCH_URL}?${query}`, {
      // The key goes in a header rather than the address, so it stays out of request logs.
      headers: { 'X-Goog-Api-Key': settings.apiKey },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    // A refused key, quota or outage: handled by the caller as "could not check".
    if (!res.ok) throw new Error(`Safe Browsing answered ${res.status}`);
    const body = (await res.json()) as SearchResponse;
    // Any listed threat makes the link unsafe; Google also checks the link's parent paths and
    // domains, so a match may name a shorter URL than the one sent.
    const unsafe = (body.threats ?? []).length > 0;
    return { unsafe, expiresAt: settings.now().getTime() + cacheMs(unsafe, durationMs(body.cacheDuration)) };
  }

  return async (url) => {
    // A cached answer that has not expired is used as it is.
    const cached = cache.get(url);
    if (cached !== undefined && cached.expiresAt > settings.now().getTime()) return verdictOf(cached.unsafe);
    try {
      const entry = await lookup(url);
      remember(url, entry);
      return verdictOf(entry.unsafe);
    } catch (err) {
      // Nothing is cached, so the next request asks again. Only the error is logged, never the key.
      settings.log(`Safe Browsing check failed: ${err instanceof Error ? err.message : String(err)}`);
      return 'unavailable';
    }
  };
}
