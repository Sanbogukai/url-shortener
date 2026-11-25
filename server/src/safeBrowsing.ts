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

// Google answers in binary protobuf. JSON is refused by this API ("Unsupported Output Format"),
// so the bytes are read by hand. The wire types say how each field is stored.
const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH = 2;
const WIRE_FIXED32 = 5;
// The low three bits of a field key hold the wire type; the rest hold the field number.
const WIRE_TYPE_BITS = 3;
const WIRE_TYPE_MASK = 7;
// Each byte of a varint carries seven bits; the top bit says another byte follows.
const VARINT_BASE = 2;
const VARINT_BITS = 7;
const VARINT_MORE = 128;
const VARINT_MASK = 127;
// Fixed-width fields, which are skipped because nothing read here uses them.
const FIXED64_BYTES = 8;
const FIXED32_BYTES = 4;
// The field numbers used: threats and cacheDuration in the search reply, seconds and nanos
// inside the Duration, and the message in an error reply.
const SEARCH_THREATS_FIELD = 1;
const SEARCH_DURATION_FIELD = 2;
const DURATION_SECONDS_FIELD = 1;
const DURATION_NANOS_FIELD = 2;
const ERROR_MESSAGE_FIELD = 2;
const NANOS_PER_MS = 1_000_000;

// One field of a binary message: its number, its wire type and its value. A varint is a
// number; a length-delimited field (text or a nested message) is its bytes.
interface Field {
  number: number;
  wire: number;
  value: number | Uint8Array;
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

// Reads one varint starting at pos: the number, and the position after it. Each byte adds
// seven more bits, lowest first. Past the end of the bytes a byte counts as 0, which ends the number.
function readVarint(bytes: Uint8Array, pos: number, shift = 0, sum = 0): [number, number] {
  // The byte at pos, or 0 past the end.
  const byte = bytes[pos] ?? 0;
  // This byte's seven bits, moved up to their place in the number.
  const total = sum + (byte & VARINT_MASK) * VARINT_BASE ** shift;
  // A clear top bit means this was the last byte.
  if ((byte & VARINT_MORE) === 0) return [total, pos + 1];
  return readVarint(bytes, pos + 1, shift + VARINT_BITS, total);
}

// Reads every field from pos to the end, in order. Fixed-width fields are skipped.
function readFields(bytes: Uint8Array, pos = 0): Field[] {
  // Nothing left to read.
  if (pos >= bytes.length) return [];
  // The key gives the field number and the wire type.
  const [key, afterKey] = readVarint(bytes, pos);
  const wire = key & WIRE_TYPE_MASK;
  const number = key >>> WIRE_TYPE_BITS;
  if (wire === WIRE_VARINT) {
    // A varint field: its value follows the key.
    const [value, next] = readVarint(bytes, afterKey);
    return [{ number, wire, value }, ...readFields(bytes, next)];
  }
  if (wire === WIRE_LENGTH) {
    // A length-delimited field: a length, then that many bytes.
    const [length, start] = readVarint(bytes, afterKey);
    return [{ number, wire, value: bytes.subarray(start, start + length) }, ...readFields(bytes, start + length)];
  }
  // Fixed-width fields have a set size; skip past them.
  if (wire === WIRE_FIXED64) return readFields(bytes, afterKey + FIXED64_BYTES);
  if (wire === WIRE_FIXED32) return readFields(bytes, afterKey + FIXED32_BYTES);
  // Any other wire type means these bytes are not the reply expected.
  throw new Error(`unknown protobuf wire type ${wire}`);
}

// The bytes of the first length-delimited field with this number, or undefined if none.
function bytesOf(fields: Field[], number: number): Uint8Array | undefined {
  // The first matching field.
  const field = fields.find((candidate) => candidate.number === number);
  return field?.value instanceof Uint8Array ? field.value : undefined;
}

// The number of the first varint field with this number, or 0 if none.
function numberOf(fields: Field[], number: number): number {
  // The first matching field.
  const field = fields.find((candidate) => candidate.number === number);
  return typeof field?.value === 'number' ? field.value : 0;
}

// A google.protobuf.Duration (seconds and nanos) in milliseconds. Missing parts count as 0.
function durationMs(bytes: Uint8Array): number {
  // The Duration's own fields.
  const fields = readFields(bytes);
  return numberOf(fields, DURATION_SECONDS_FIELD) * MS_PER_SECOND + numberOf(fields, DURATION_NANOS_FIELD) / NANOS_PER_MS;
}

// Reads Google's search reply: whether any threat is listed, and how long the answer may be kept.
// Any threat entry at all makes the link unsafe.
function parseSearch(bytes: Uint8Array): { unsafe: boolean; serverMs: number } {
  // The reply's top-level fields.
  const fields = readFields(bytes);
  // The cache time, if Google sent one, as milliseconds.
  const duration = bytesOf(fields, SEARCH_DURATION_FIELD);
  return {
    unsafe: fields.some((field) => field.number === SEARCH_THREATS_FIELD),
    serverMs: duration === undefined ? 0 : durationMs(duration),
  };
}

// How long an answer may be kept. An unsafe answer keeps exactly what Google said. A clean
// one keeps at least an hour, and never more than the day the API allows.
function cacheMs(unsafe: boolean, serverMs: number): number {
  if (unsafe) return serverMs;
  return Math.min(Math.max(serverMs, MIN_SAFE_CACHE_MS), MAX_SAFE_CACHE_MS);
}

// Google's own explanation of a refused request, such as "API key not valid", from the message
// field of its error reply. It never contains the key. Unreadable bytes give a placeholder, so
// the status code still shows.
function googleMessage(bytes: Uint8Array): string {
  try {
    // The message's bytes, if the reply has one.
    const text = bytesOf(readFields(bytes), ERROR_MESSAGE_FIELD);
    return text === undefined ? 'no message' : new TextDecoder().decode(text);
  } catch {
    // Not a protobuf message at all: only the status is known.
    return 'no readable message';
  }
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
    // URLSearchParams escapes the link, so its own ? and & cannot break the query. No alt
    // parameter is sent, so Google answers with its default binary reply, which is read below.
    const query = new URLSearchParams({ urls: url });
    const res = await settings.fetch(`${SEARCH_URL}?${query}`, {
      // The key goes in a header rather than the address, so it stays out of request logs.
      headers: { 'X-Goog-Api-Key': settings.apiKey },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    // The whole reply, read as bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A refused key, quota or outage: handled by the caller as "could not check". Google's
    // message goes into the log, so the cause shows without guessing.
    if (!res.ok) throw new Error(`Safe Browsing answered ${res.status}: ${googleMessage(bytes)}`);
    // Whether the link is listed, and the cache time Google gave. Any listed threat makes the
    // link unsafe; Google also checks the link's parent paths and domains, so a match may name
    // a shorter URL than the one sent.
    const { unsafe, serverMs } = parseSearch(bytes);
    return { unsafe, expiresAt: settings.now().getTime() + cacheMs(unsafe, serverMs) };
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
