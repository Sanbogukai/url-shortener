// The whole app: a header, then either the home page or a link's stats page.
// There are only two pages, so the address is read directly instead of adding a router.

// The newest link made on this visit, for the result card.
import { useState } from 'react'
import type { Link } from '../../shared/types.ts'
// The parts of the page.
import { ResultCard } from './components/ResultCard.tsx'
import { ShortenForm } from './components/ShortenForm.tsx'
import { StatsPage } from './components/StatsPage.tsx'
import { YourLinks } from './components/YourLinks.tsx'
// The links remembered in this browser.
import { useSavedLinks } from './savedLinks.ts'

// Stats pages live under this path, as in /stats/gym-plan.
const STATS_PREFIX = '/stats/'

// The code in a stats address, or null on any other page. Read once: moving between pages
// is an ordinary link, which loads the page again.
function statsCode(): string | null {
  const path = location.pathname
  if (!path.startsWith(STATS_PREFIX)) return null
  // decodeURIComponent undoes any %-escapes the browser added.
  const code = decodeURIComponent(path.slice(STATS_PREFIX.length))
  // /stats/ with nothing after it is treated as the home page.
  return code === '' ? null : code
}

// The home page: the form, the result card, and Your links.
function Home() {
  const { links, remember, forget } = useSavedLinks()
  // The link just made, or null before the first one.
  const [latest, setLatest] = useState<Link | null>(null)

  // A new link is both shown in the card and saved to the top of the list.
  function created(link: Link) {
    setLatest(link)
    remember(link)
  }

  return (
    <>
      <section className="hero">
        <h1>Make long links short</h1>
        <p className="hero-sub">Paste a link, pick a name if you like, and see who clicks it.</p>
        {/* The live demo runs on free hosting with no lasting disk, so say so up front. */}
        <p className="demo-note">Demo: links are wiped when the server restarts, which happens after about 15 idle minutes.</p>
        <ShortenForm onCreated={created} />
        {/* key makes React build a fresh card for each new link, so screen readers announce it. */}
        {latest && <ResultCard key={latest.code} link={latest} />}
      </section>
      <YourLinks links={links} onForget={forget} />
    </>
  )
}

export default function App() {
  const code = statsCode()

  return (
    <div className="page">
      <header className="site-header">
        {/* The brand mark links home from every page. */}
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>URL Shortener</span>
        </a>
      </header>
      <main>{code === null ? <Home /> : <StatsPage code={code} />}</main>
    </div>
  )
}
