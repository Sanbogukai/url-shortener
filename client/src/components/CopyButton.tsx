// A button that copies a short link to the clipboard and says so for a moment.

// State for the button's label, and a ref to the timer that resets it.
import { useEffect, useRef, useState } from 'react'

// How long "Copied" stays before the label goes back, in milliseconds.
const FEEDBACK_MS = 2000

// What the button can say.
type CopyState = 'idle' | 'copied' | 'failed'

// The label for each state.
const LABELS: Record<CopyState, string> = { idle: 'Copy', copied: 'Copied', failed: 'Copy failed' }

// `text` is what goes on the clipboard; `label` names it for screen readers.
export function CopyButton({ text, label }: { text: string; label: string }) {
  // Which label to show.
  const [state, setState] = useState<CopyState>('idle')
  // The pending reset timer, kept so a second click or leaving the page can cancel it.
  const timer = useRef<number | undefined>(undefined)

  // On unmount, cancel any pending reset, so it never updates a button that is gone.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Copies, then shows the result and schedules the reset.
  async function copy() {
    // The clipboard API is a promise; it fails on plain-http pages other than localhost, or
    // when the user has blocked clipboard access.
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    // A click during the previous message restarts the countdown instead of stacking timers.
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), FEEDBACK_MS)
  }

  return (
    // aria-live makes screen readers announce "Copied" when the label changes.
    <button type="button" className="button secondary" onClick={copy} aria-label={`${LABELS[state]}: ${label}`}>
      <span aria-live="polite">{LABELS[state]}</span>
    </button>
  )
}
