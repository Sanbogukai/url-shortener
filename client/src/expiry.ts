// The expiry choices on the form, and how each becomes the `expiresAt` the API expects.

// A day in milliseconds, for the preset lengths.
const DAY_MS = 86_400_000

// The choices: never, a preset number of days, or a date the user picks.
export type ExpiryChoice = 'never' | '1' | '7' | '30' | 'custom'

// One button in the expiry row.
interface Preset {
  // The value stored in state when this button is pressed.
  value: ExpiryChoice
  // The button text.
  label: string
}

// The buttons, in the order they appear. Preset values are day counts, so the conversion
// below can read the number straight from the value.
export const EXPIRY_PRESETS: Preset[] = [
  { value: 'never', label: 'Never' },
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'custom', label: 'Custom' },
]

// What the form gets back: the value to send, or a message to show under the field.
type ExpiryResult = { expiresAt?: string; error?: string }

// Turns the chosen button (and the picker's text, for Custom) into an ISO date-time string.
// It is worked out at the moment of sending, so "1 day" means a day from the click.
export function toExpiresAt(choice: ExpiryChoice, custom: string): ExpiryResult {
  // No expiry: the field is left out of the request.
  if (choice === 'never') return {}
  // Custom: the picker's value, such as '2026-12-01T09:30', read in the user's local time.
  if (choice === 'custom') {
    // An empty picker is a mistake the user can fix, not a "never".
    if (custom === '') return { error: 'Pick a date and time' }
    // new Date reads a date-time with no zone as local time; toISOString turns it into UTC
    // with a Z, which the server accepts.
    return { expiresAt: new Date(custom).toISOString() }
  }
  // A preset: the value is the number of days.
  return { expiresAt: new Date(Date.now() + Number(choice) * DAY_MS).toISOString() }
}

// Each date part in the picker's format is two digits wide.
const PART_WIDTH = 2

// Two digits, padded with a zero, for the picker's minimum below.
const pad = (n: number) => String(n).padStart(PART_WIDTH, '0')

// The current local time as the picker's text format, 'YYYY-MM-DDTHH:MM'. Used as the
// picker's minimum so past times are greyed out; the server checks again anyway.
export function nowForPicker(): string {
  // One reading of the clock for every part.
  const d = new Date()
  // getMonth counts from 0, so January is 0 and needs the + 1.
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
