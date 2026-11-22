// The card under the form that shows the link just made, ready to copy.

// The link the server returned.
import type { Link } from '../../../shared/types.ts'
// Formatting helpers.
import { formatDateTime, shortUrl } from '../format.ts'
// The Copy button.
import { CopyButton } from './CopyButton.tsx'

// `link` is the newest link made on this page.
export function ResultCard({ link }: { link: Link }) {
  // The full short address, such as https://host/gym-plan.
  const short = shortUrl(link.code)

  return (
    // role="status" announces the new link to screen readers when the card appears.
    <section className="result card" role="status" aria-label="Your new short link">
      <p className="result-label">Your short link</p>
      <div className="result-row">
        {/* Opens in a new tab, so trying the link does not leave this page. */}
        <a className="result-link" href={short} target="_blank" rel="noreferrer">
          {short}
        </a>
        <div className="result-actions">
          <CopyButton text={short} label={short} />
          <a className="button secondary" href={`/stats/${link.code}`}>
            Stats
          </a>
        </div>
      </div>
      {/* The long URL, so the user can see the link went to the right place. */}
      <p className="result-target muted">
        Goes to <span className="long-url">{link.url}</span>
      </p>
      {link.expiresAt && <p className="muted">Expires {formatDateTime(link.expiresAt)}</p>}
    </section>
  )
}
