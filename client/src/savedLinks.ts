// The "Your links" list. The API has no accounts, so the links made in this browser are
// remembered in localStorage, which keeps them across visits on this browser only.

// React state, so the page redraws when the list changes.
import { useState } from 'react'
// The stored shape is exactly the link the server returned.
import type { Link } from '../../shared/types.ts'

// The localStorage key. The prefix keeps it apart from other apps on the same host.
const STORAGE_KEY = 'url-shortener.links'

// True for a value with the fields a saved link needs.
function isLink(value: unknown): value is Link {
  // typeof null is 'object', so null is ruled out first.
  if (typeof value !== 'object' || value === null) return false
  // Looks at the fields without trusting them yet.
  const entry = value as Record<string, unknown>
  // The code and the long URL are what the list shows.
  return typeof entry.code === 'string' && typeof entry.url === 'string'
}

// Reads the saved list, newest first. Anything unreadable gives an empty list instead of a
// crash: the data might be from an older version, or edited by hand in the browser tools.
function load(): Link[] {
  // try/catch because JSON.parse throws on broken text, and localStorage itself can throw
  // when storage is turned off in the browser.
  try {
    // getItem gives null when nothing is saved yet; an empty list stands in for that.
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    // Keeps only entries that look like links, so one bad entry cannot break the page.
    return Array.isArray(parsed) ? parsed.filter(isLink) : []
  } catch {
    // Unreadable: start again with nothing.
    return []
  }
}

// Writes the list back. A failure (storage full or turned off) only means the list will not
// survive a reload, so it is ignored rather than shown as an error.
function save(links: Link[]): void {
  // try/catch because setItem throws when storage is full or blocked.
  try {
    // localStorage holds strings only, so the list goes in as JSON.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links))
  } catch {
    // Nothing useful to do: the in-memory list still works for this visit.
  }
}

// The saved list as React state, with the two ways to change it.
export function useSavedLinks() {
  // The function form of useState reads localStorage once, on the first render only.
  const [links, setLinks] = useState<Link[]>(load)

  // Puts a new link at the top. A link with the same code is dropped first, so it never
  // shows twice.
  function remember(link: Link): void {
    // Builds the new list from the current one.
    const next = [link, ...links.filter((saved) => saved.code !== link.code)]
    // Shows it now and keeps it for next time.
    setLinks(next)
    save(next)
  }

  // Removes one link from this browser's list. The short link itself keeps working.
  function forget(code: string): void {
    // Everything except that code.
    const next = links.filter((saved) => saved.code !== code)
    // Shows it now and keeps it for next time.
    setLinks(next)
    save(next)
  }

  // The list and both actions, for App to hand down.
  return { links, remember, forget }
}
