// Small helpers that turn the server's values into text for the page.

// The server's time format, 'YYYY-MM-DD HH:MM:SS' in UTC, as SQLite writes it.
type SqlTime = string

// The full short link for a code, on whatever host is serving this page, such as
// https://example.onrender.com/gym-plan.
export function shortUrl(code: string): string {
  // location.origin is the scheme, host and port, with no trailing slash.
  return `${location.origin}/${code}`
}

// Reads a server time as a Date. The space becomes the ISO 'T' and the Z marks it as UTC;
// without the Z the browser would read it as local time and be hours out.
export function parseSqlTime(value: SqlTime): Date {
  // '2026-11-22 12:00:00' becomes '2026-11-22T12:00:00Z'.
  return new Date(`${value.replace(' ', 'T')}Z`)
}

// One shared formatter for dates with times, in the reader's own language and time zone,
// such as "22 Nov 2026, 12:00". Building it once is cheaper than per call.
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// A server time as the reader's local date and time.
export function formatDateTime(value: SqlTime): string {
  // Converts from UTC to local time as it formats.
  return dateTime.format(parseSqlTime(value))
}

// Chart days are UTC calendar days, so they are labelled in UTC too, or a day could shift.
const dayLabel = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

// A chart day, 'YYYY-MM-DD', as a short label such as "22 Nov".
export function formatDay(day: string): string {
  // Midnight UTC on that day, formatted in UTC, so the label is always the same day.
  return dayLabel.format(new Date(`${day}T00:00:00Z`))
}

// True when an expiry time has passed. The server's rule is the same: a link stops at its
// expiry moment exactly.
export function hasExpired(expiresAt: SqlTime | null): boolean {
  // null means the link never expires.
  return expiresAt !== null && parseSqlTime(expiresAt).getTime() <= Date.now()
}

// "1 click" or "5 clicks".
export function clicksLabel(count: number): string {
  // Only exactly one takes the singular.
  return `${count} ${count === 1 ? 'click' : 'clicks'}`
}
