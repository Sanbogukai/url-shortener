// The stats page at /stats/:code: where the link goes, its dates and totals, the 30-day
// chart and the top referrers.

// The stats are fetched once the page has rendered.
import { useEffect, useState } from 'react'
// The answer's shape.
import type { LinkStats } from '../../../shared/types.ts'
// The stats call, and the status that means "no such link".
import { ApiError, getStats, HTTP_NOT_FOUND, messageOf } from '../api.ts'
// Formatting helpers.
import { formatDateTime, hasExpired, shortUrl } from '../format.ts'
// The page's parts.
import { ClickChart } from './ClickChart.tsx'
import { CopyButton } from './CopyButton.tsx'
import { ReferrerList } from './ReferrerList.tsx'

// Every state the page can be in, so the render below can never mix two of them.
type PageState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; stats: LinkStats }

// What the Expires line says: never, the date, or the date marked as past.
function expiryText(expiresAt: string | null): string {
  if (expiresAt === null) return 'Never'
  // Past or future, the date is shown; a past one says so.
  const when = formatDateTime(expiresAt)
  return hasExpired(expiresAt) ? `${when} (expired)` : when
}

// `code` comes from the address bar, read by App.
export function StatsPage({ code }: { code: string }) {
  const [state, setState] = useState<PageState>({ kind: 'loading' })

  useEffect(() => {
    // Set when the code changes or the page unmounts, so a late answer is ignored.
    let stale = false
    // Effects cannot be async themselves, so the async work runs in a named function.
    async function load() {
      try {
        const stats = await getStats(code)
        if (!stale) setState({ kind: 'ready', stats })
      } catch (caught) {
        if (stale) return
        // A 404 gets its own friendly page; anything else shows the error.
        if (caught instanceof ApiError && caught.status === HTTP_NOT_FOUND) setState({ kind: 'missing' })
        else setState({ kind: 'failed', message: messageOf(caught) })
      }
    }
    load()
    // Cleanup: marks this run's answer as out of date.
    return () => {
      stale = true
    }
  }, [code])

  // The page title follows the link, so browser tabs and history are easy to tell apart.
  useEffect(() => {
    document.title = `Stats for /${code} · URL Shortener`
  }, [code])

  if (state.kind === 'loading') return <p className="muted center">Loading stats…</p>
  if (state.kind === 'missing') {
    return (
      <section className="card center-card">
        <h1>No such link</h1>
        <p className="muted">There is no short link /{code}. Codes are case-sensitive.</p>
        <a className="button primary" href="/">
          Make a short link
        </a>
      </section>
    )
  }
  if (state.kind === 'failed') {
    return (
      <p className="form-error center" role="alert">
        {state.message}
      </p>
    )
  }

  // From here on the stats are loaded.
  const { stats } = state
  const short = shortUrl(stats.code)

  return (
    <article className="stats">
      <header className="stats-header card">
        <p className="result-label">Stats for</p>
        <div className="result-row">
          <a className="result-link" href={short} target="_blank" rel="noreferrer">
            {short}
          </a>
          <CopyButton text={short} label={short} />
        </div>
        <p className="muted">
          Goes to{' '}
          <a className="long-url" href={stats.url} target="_blank" rel="noreferrer">
            {stats.url}
          </a>
        </p>
      </header>

      {/* A description list pairs each figure with its name. */}
      <dl className="figures">
        <div className="figure card">
          <dt>Total clicks</dt>
          <dd className="figure-value">{stats.totalClicks}</dd>
        </div>
        <div className="figure card">
          <dt>Last click</dt>
          <dd>{stats.lastClickAt ? formatDateTime(stats.lastClickAt) : 'Never'}</dd>
        </div>
        <div className="figure card">
          <dt>Created</dt>
          <dd>{formatDateTime(stats.createdAt)}</dd>
        </div>
        <div className="figure card">
          <dt>Expires</dt>
          <dd>{expiryText(stats.expiresAt)}</dd>
        </div>
      </dl>

      <section className="card" aria-labelledby="chart-heading">
        <h2 id="chart-heading">Clicks per day, last 30 days (UTC)</h2>
        <ClickChart daily={stats.daily} />
      </section>

      <section className="card" aria-labelledby="referrers-heading">
        <h2 id="referrers-heading">Top referrers</h2>
        <ReferrerList referrers={stats.referrers} />
      </section>
    </article>
  )
}
