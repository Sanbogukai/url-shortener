// Thin, typed wrappers over fetch. This is the only file that talks to the server;
// components call these functions instead. Every failure becomes an ApiError whose
// message is safe to show, with the server's per-field issues attached when there are any.

// The shapes the server sends back. `import type` is erased before the code runs.
import type { ApiError as ErrorBody, CreateLink, Issue, Link, LinkStats } from '../../shared/types.ts'

// 404 "not found": the stats page shows its own message for this one.
export const HTTP_NOT_FOUND = 404
// Statuses from 500 up are the server's fault, not the request's.
const HTTP_SERVER_ERROR = 500

// An Error that also carries the HTTP status and any field issues from the response.
export class ApiError extends Error {
  // The response status, or 0 when no response arrived at all.
  status: number
  // Empty unless the server named the fields at fault (400 and 409 answers do).
  issues: Issue[]

  // Takes the message to show, the status and any field issues.
  constructor(message: string, status: number, issues: Issue[] = []) {
    // Sets the standard Error message.
    super(message)
    // Names the class in stack traces and console output.
    this.name = 'ApiError'
    // Keeps the status, so callers can tell "no such link" from other failures.
    this.status = status
    // Keeps the issues for whoever catches this.
    this.issues = issues
  }
}

// Sends one request to /api + path and returns the parsed JSON body as type T.
// The caller names T; TypeScript trusts that the server sends that shape, which holds
// because both sides share the types in shared/types.ts.
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Relative URL: in development Vite forwards /api to the server (vite.config.ts);
  // in production the same Express server serves both the page and /api.
  const res = await fetch(`/api${path}`, {
    // Only requests with a body say they are sending JSON. The server refuses anything else.
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    // Copies in method, body and anything else the caller passed.
    ...init,
  })
  // Reads the JSON body; if the body is not JSON at all, use null instead of crashing.
  const body: unknown = await res.json().catch(() => null)
  // res.ok is true for statuses 200 to 299; anything else is an error.
  if (!res.ok) {
    // Treat the body as an error body; a null body becomes an empty object. Partial, because
    // a proxy or crash page might send something else entirely.
    const problem = (body ?? {}) as Partial<ErrorBody>
    // With no message of its own, a 5xx usually means the API server is down (Vite's proxy
    // answers 502 then), so say that rather than a bare status code.
    const fallback = res.status >= HTTP_SERVER_ERROR ? 'The server is not responding' : 'Request failed'
    // Prefer the server's own message; otherwise the fallback with the status code.
    throw new ApiError(problem.error ?? `${fallback} (${res.status})`, res.status, problem.issues ?? [])
  }
  // Success: the parsed data, as the type the caller asked for.
  return body as T
}

// Turns anything thrown into a message fit to show on screen.
export function messageOf(error: unknown): string {
  // Errors (ApiError included) carry their own message; fetch failing offline is a TypeError.
  if (error instanceof Error) return error.message
  // Anything else thrown is unexpected; say so plainly.
  return 'Something went wrong'
}

// Makes a short link. The answer is the stored link, with its random code or the alias.
export const createLink = (input: CreateLink) =>
  request<Link>('/links', { method: 'POST', body: JSON.stringify(input) })

// One link with its click totals, 30-day chart and top referrers. encodeURIComponent keeps
// an odd code from changing the path, though valid codes never need it.
export const getStats = (code: string) => request<LinkStats>(`/links/${encodeURIComponent(code)}`)
