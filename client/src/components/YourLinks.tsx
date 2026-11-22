// "Your links": the links made in this browser, newest first, with their click counts.

// The click counts are fetched after the list renders.
import { useEffect, useState } from 'react'
// The saved shape.
import type { Link } from '../../../shared/types.ts'
// The stats call.
import { getStats } from '../api.ts'
// Formatting helpers.
import { clicksLabel, hasExpired, shortUrl } from '../format.ts'

// Click counts by code. A code that is missing has not loaded yet; null means the count
// could not be read (the server is down, or the link is gone after a database reset).
type Counts = Record<string, number | null>

// Reads every link's click count at once. allSettled waits for all of them even when some
// fail, so one bad link cannot hide the others' counts.
async function loadCounts(codes: string[]): Promise<Counts> {
  // One stats request per link; a short personal list keeps this small.
  const results = await Promise.allSettled(codes.map((code) => getStats(code)))
  // Pairs each code with its result: the total, or null for a failure.
  return Object.fromEntries(
    results.map((result, index) => [codes[index], result.status === 'fulfilled' ? result.value.totalClicks : null]),
  )
}

// The count text for one row.
function countText(count: number | null | undefined): string {
  // Still loading.
  if (count === undefined) return '…'
  // Could not be read.
  if (count === null) return 'Clicks unavailable'
  return clicksLabel(count)
}

// `links` comes from localStorage via App; `onForget` drops one from it.
export function YourLinks({ links, onForget }: { links: Link[]; onForget: (code: string) => void }) {
  // The counts loaded so far.
  const [counts, setCounts] = useState<Counts>({})
  // The codes as one string, so the effect below reruns only when the set of codes changes,
  // not on every render (a new array each time would look like a change).
  const codesKey = links.map((link) => link.code).join(' ')

  useEffect(() => {
    // Set when the effect is replaced or the list unmounts, so a late answer is ignored.
    let stale = false
    // Effects cannot be async themselves, so the async work runs in a named function.
    async function refresh() {
      // An empty key splits into [''], so an empty list is handled first.
      const fresh = codesKey === '' ? {} : await loadCounts(codesKey.split(' '))
      if (!stale) setCounts(fresh)
    }
    refresh()
    // Cleanup: marks this run's answer as out of date.
    return () => {
      stale = true
    }
  }, [codesKey])

  return (
    <section className="your-links" aria-labelledby="your-links-heading">
      <h2 id="your-links-heading">Your links</h2>
      {links.length === 0 ? (
        // The empty state explains where the list lives, so its absence elsewhere is no surprise.
        <p className="empty card">
          Links you make here are listed here. They are kept in this browser only.
        </p>
      ) : (
        <ul className="link-list card">
          {links.map((link) => (
            <li key={link.code} className="link-row">
              <div className="link-main">
                <a className="link-short" href={shortUrl(link.code)} target="_blank" rel="noreferrer">
                  {/* The host is the same on every row, so only the path is shown. */}/{link.code}
                </a>
                {/* title shows the whole URL on hover when the row cuts it short. */}
                <span className="link-long muted" title={link.url}>
                  {link.url}
                </span>
              </div>
              <div className="link-meta">
                {hasExpired(link.expiresAt) && <span className="badge">Expired</span>}
                <span className="link-count">{countText(counts[link.code])}</span>
                <a className="button small secondary" href={`/stats/${link.code}`}>
                  Stats
                </a>
                {/* aria-label names the link, since every row has a button with the same text. */}
                <button
                  type="button"
                  className="button small quiet"
                  onClick={() => onForget(link.code)}
                  aria-label={`Forget /${link.code} (removes it from this list only)`}
                  title="Remove from this list. The short link keeps working."
                >
                  Forget
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
