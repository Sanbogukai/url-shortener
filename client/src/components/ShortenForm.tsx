// The hero form: the long URL, an optional alias and an expiry. On success it hands the new
// link up to App and clears itself for the next one.

// Form state, and an id helper so labels and error messages connect to their inputs.
import { useId, useState, type FormEvent } from 'react'
// The link the server returns.
import type { Issue, Link } from '../../../shared/types.ts'
// The API call and error helpers.
import { ApiError, createLink, HTTP_SERVICE_UNAVAILABLE, messageOf } from '../api.ts'
// The expiry buttons and their conversion.
import { EXPIRY_PRESETS, nowForPicker, toExpiresAt, type ExpiryChoice } from '../expiry.ts'

// Field errors keyed by field name: url, alias or expiresAt.
type FieldErrors = Partial<Record<string, string>>

// The server's issue list as a lookup by field. With two issues for one field, the first wins.
function byField(issues: Issue[]): FieldErrors {
  // Reversed, so that when entries share a field, the first issue is written last and wins.
  // Object.fromEntries builds the lookup from [field, message] pairs.
  return Object.fromEntries(issues.toReversed().map((issue) => [issue.field, issue.message]))
}

// `onCreated` receives each new link.
export function ShortenForm({ onCreated }: { onCreated: (link: Link) => void }) {
  // The three fields.
  const [url, setUrl] = useState('')
  const [alias, setAlias] = useState('')
  const [expiry, setExpiry] = useState<ExpiryChoice>('never')
  // The Custom picker's text, 'YYYY-MM-DDTHH:MM', or '' when nothing is picked.
  const [custom, setCustom] = useState('')
  // Errors under particular fields, and one general error for everything else (429, offline).
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')
  // The notice banner's text when a service is down (a 503), or '' when there is none.
  const [notice, setNotice] = useState('')
  // True while a request is on its way, so a double click cannot make two links.
  const [busy, setBusy] = useState(false)
  // A unique prefix for this form's element ids.
  const id = useId()

  // Sends the form.
  async function submit(event: FormEvent<HTMLFormElement>) {
    // Stops the browser's own full-page form submission.
    event.preventDefault()
    // Clears the last attempt's errors.
    setFieldErrors({})
    setFormError('')
    setNotice('')
    // The expiry is worked out now, so "1 day" counts from this click.
    const { expiresAt, error } = toExpiresAt(expiry, custom)
    // A Custom expiry with no date is caught here, without a round trip.
    if (error) {
      setFieldErrors({ expiresAt: error })
      return
    }
    setBusy(true)
    // try/finally so the button comes back even when the request fails.
    try {
      // Blank optional fields are left out, as the API expects. trim drops stray spaces from a paste.
      const link = await createLink({ url: url.trim(), alias: alias.trim() || undefined, expiresAt })
      // Hands the link up, then resets the form for the next one.
      onCreated(link)
      setUrl('')
      setAlias('')
      setExpiry('never')
      setCustom('')
    } catch (caught) {
      // Field issues (400, and 409 for a taken alias) go under their fields; anything else at the top.
      // A 503 means a service is down, not that the request was wrong: it gets the banner.
      if (caught instanceof ApiError && caught.issues.length > 0) setFieldErrors(byField(caught.issues))
      else if (caught instanceof ApiError && caught.status === HTTP_SERVICE_UNAVAILABLE) setNotice(caught.message)
      else setFormError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  // The ids of each error message, so an input can point at its own with aria-describedby.
  const errorId = (field: string) => `${id}-${field}-error`

  return (
    // noValidate turns off the browser's own pop-up checks, so every message looks the same
    // and comes from one place: the server's rules.
    <form className="shorten card" onSubmit={submit} noValidate>
      {/* The service notice sits at the top of the card. role="status" announces it politely,
          since it is news about the service, not a mistake in what was typed. */}
      {notice && (
        <div className="notice-banner" role="status">
          {/* A circled "i", drawn inline so it needs no image file; hidden from screen readers. */}
          <svg className="notice-icon" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="9.25" y="8.5" width="1.5" height="6" rx="0.75" fill="currentColor" />
            <circle cx="10" cy="5.75" r="1" fill="currentColor" />
          </svg>
          <div>
            <strong>Service temporarily unavailable</strong>
            {notice}
          </div>
        </div>
      )}
      <div className="hero-row">
        <label htmlFor={`${id}-url`} className="visually-hidden">
          Long URL
        </label>
        <input
          id={`${id}-url`}
          className="hero-input"
          type="url"
          inputMode="url"
          placeholder="Paste a long link, such as https://example.com/a/very/long/page"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          // Marks the field as wrong for screen readers, and links it to the message.
          aria-invalid={fieldErrors.url !== undefined}
          aria-describedby={fieldErrors.url ? errorId('url') : undefined}
          autoFocus
        />
        <button type="submit" className="button primary hero-button" disabled={busy}>
          {busy ? 'Shortening…' : 'Shorten'}
        </button>
      </div>
      {fieldErrors.url && (
        <p id={errorId('url')} className="field-error">
          {fieldErrors.url}
        </p>
      )}

      <div className="options">
        <div className="option">
          <label htmlFor={`${id}-alias`}>
            Custom alias <span className="muted">(optional)</span>
          </label>
          {/* The host in front shows what the finished link will look like. */}
          <div className="alias-field">
            <span className="alias-prefix" aria-hidden="true">
              {location.host}/
            </span>
            <input
              id={`${id}-alias`}
              type="text"
              placeholder="gym-plan"
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              aria-invalid={fieldErrors.alias !== undefined}
              aria-describedby={fieldErrors.alias ? errorId('alias') : `${id}-alias-hint`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {fieldErrors.alias ? (
            <p id={errorId('alias')} className="field-error">
              {fieldErrors.alias}
            </p>
          ) : (
            <p id={`${id}-alias-hint`} className="hint">
              3 to 30 letters, digits or dashes.
            </p>
          )}
        </div>

        {/* A fieldset groups the buttons under one label for screen readers. */}
        <fieldset className="option">
          <legend>Expires</legend>
          <div className="segmented" role="radiogroup" aria-label="Expires">
            {EXPIRY_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                role="radio"
                aria-checked={expiry === preset.value}
                className={expiry === preset.value ? 'segment selected' : 'segment'}
                onClick={() => setExpiry(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {/* The picker only appears for Custom. Its min greys out times already past. */}
          {expiry === 'custom' && (
            <>
              <label htmlFor={`${id}-custom`} className="visually-hidden">
                Expiry date and time
              </label>
              <input
                id={`${id}-custom`}
                type="datetime-local"
                className="custom-date"
                value={custom}
                min={nowForPicker()}
                onChange={(event) => setCustom(event.target.value)}
                aria-invalid={fieldErrors.expiresAt !== undefined}
                aria-describedby={fieldErrors.expiresAt ? errorId('expiresAt') : undefined}
              />
            </>
          )}
          {fieldErrors.expiresAt && (
            <p id={errorId('expiresAt')} className="field-error">
              {fieldErrors.expiresAt}
            </p>
          )}
        </fieldset>
      </div>

      {/* role="alert" reads the message out as soon as it appears. */}
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
    </form>
  )
}
