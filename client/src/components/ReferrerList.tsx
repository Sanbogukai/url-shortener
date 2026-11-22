// The top referring sites on the stats page, each with a bar sized by its share of clicks.

// One referrer: a host and its clicks.
import type { ReferrerCount } from '../../../shared/types.ts'
// The "N clicks" label.
import { clicksLabel } from '../format.ts'

// Bar widths are percentages of the row.
const FULL_WIDTH = 100

// `referrers` is the server's list, most clicks first, at most five.
export function ReferrerList({ referrers }: { referrers: ReferrerCount[] }) {
  // No clicks yet means no referrers either.
  if (referrers.length === 0) return <p className="muted">No clicks yet.</p>
  // The first entry has the most clicks, so it sets the full bar width.
  const top = referrers[0]?.clicks ?? 1

  return (
    <ol className="referrers">
      {referrers.map((referrer) => (
        <li key={referrer.host} className="referrer">
          <div className="referrer-text">
            <span className="referrer-host">{referrer.host}</span>
            <span className="muted">{clicksLabel(referrer.clicks)}</span>
          </div>
          {/* Decoration only: the number beside it already says the same. */}
          <div className="referrer-track" aria-hidden="true">
            <div className="referrer-bar" style={{ width: `${(referrer.clicks / top) * FULL_WIDTH}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}
