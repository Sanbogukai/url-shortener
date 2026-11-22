// GET /:code, the short link itself: records the visit and sends the visitor on.

// Router groups routes.
import { Router } from 'express';
// The services the route uses: database and clock.
import type { AppDeps } from './app.ts';
// Rules for what a code can look like.
import { looksLikeCode } from './codes.ts';
// The SQL for links and clicks.
import { findLink, isExpired, recordClick } from './links.ts';

// Status codes used below.
const HTTP_FOUND = 302;
const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;

// A small HTML page for a person who followed a broken link. Only fixed text goes in, never
// anything from the request, so nothing a visitor types can end up in the page as HTML.
function page(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5}</style>
</head>
<body>
<h1>${title}</h1>
<p>${message}</p>
<p><a href="/">Make a short link</a></p>
</body>
</html>`;
}

// The host of the page the visitor came from, or null for a direct visit. Only the host is
// kept: the full address could include someone's private page or search terms.
export function referrerHost(referer: string | undefined): string | null {
  // No header, or one that is not a valid URL, counts as direct.
  if (referer === undefined || !URL.canParse(referer)) return null;
  // `|| null` turns an empty host (as in a file: URL) into a direct visit too.
  return new URL(referer).hostname || null;
}

// Builds the router for short links; app.ts mounts it at the root.
export function redirectRouter(deps: AppDeps): Router {
  // The route below is attached to this router.
  const router = Router();

  // Express also runs GET routes for HEAD requests, which ask for the headers only.
  router.get('/:code', (req, res) => {
    // Every answer here, redirect or error, must be fetched fresh each time. A cached
    // redirect would skip the server, and that visit would never be counted.
    res.set('Cache-Control', 'no-store');
    // A value that cannot be a code is not looked up at all.
    const row = looksLikeCode(req.params.code) ? findLink(deps.db, req.params.code) : undefined;
    if (row === undefined) {
      // 404 "not found": there has never been a link with this code.
      res.status(HTTP_NOT_FOUND).type('html').send(page('Link not found', 'There is no short link at this address.'));
      return;
    }
    // One reading of the clock for both the expiry check and the click.
    const now = deps.now();
    if (isExpired(row, now)) {
      // 410 "gone": the link existed, and has expired on purpose.
      res.status(HTTP_GONE).type('html').send(page('Link expired', 'This short link has expired and no longer works.'));
      return;
    }
    // Link checkers and previews often send HEAD; only a real GET is a visit.
    if (req.method === 'GET') recordClick(deps.db, row.id, referrerHost(req.get('Referer')), now);
    // 302 "found": go there this time, but ask again next time, so every visit is counted.
    res.redirect(HTTP_FOUND, row.url);
  });

  // app.ts mounts this at the root, after /api.
  return router;
}
