// The built client served by the same app: the page, its hashed files, the stats page
// fallback, and the order that keeps short links and files from getting in each other's way.

// A throwaway folder that stands in for client/dist.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// describe groups tests, it is one test, expect checks a value.
import { describe, expect, it } from 'vitest';
// A fresh app, a way to add a link directly, and status codes by name.
import { FOUND, GOOD_URL, insertLinkRow, makeApp, NOT_FOUND, OK } from './helpers.ts';

// A text only the fake index.html contains, to tell it apart from any other page.
const PAGE_MARKER = 'fake client build';

// Builds a fake client/dist with an index.html and one hashed asset, and returns its path.
function fakeBuild(): string {
  // mkdtempSync adds random characters, so parallel tests never share a folder.
  const dir = mkdtempSync(join(tmpdir(), 'url-shortener-dist-'));
  // The page every app address serves.
  writeFileSync(join(dir, 'index.html'), `<!doctype html><title>${PAGE_MARKER}</title>`);
  // assets/ is where Vite puts its hashed files.
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log("app")');
  return dir;
}

describe('with a client build', () => {
  it('serves index.html at /', async () => {
    const res = await makeApp({ clientDist: fakeBuild() }).api.get('/');

    // The page itself, as HTML.
    expect(res.status).toBe(OK);
    expect(res.text).toContain(PAGE_MARKER);
  });

  it('serves index.html for a stats page, so a reload works', async () => {
    const res = await makeApp({ clientDist: fakeBuild() }).api.get('/stats/anything');

    // Same page; the client reads the code from the address.
    expect(res.status).toBe(OK);
    expect(res.text).toContain(PAGE_MARKER);
  });

  it('lets browsers keep hashed assets for a year', async () => {
    const res = await makeApp({ clientDist: fakeBuild() }).api.get('/assets/index-abc123.js');

    // The file, marked as never changing.
    expect(res.status).toBe(OK);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('still redirects short links', async () => {
    const { api, db } = makeApp({ clientDist: fakeBuild() });
    insertLinkRow(db, 'gym-plan', GOOD_URL);

    const res = await api.get('/gym-plan');

    // The static files did not swallow the code.
    expect(res.status).toBe(FOUND);
    expect(res.headers.location).toBe(GOOD_URL);
  });

  it('answers other addresses with an HTML 404 page', async () => {
    const res = await makeApp({ clientDist: fakeBuild() }).api.get('/some/other/place');

    // A readable page, not the app and not JSON.
    expect(res.status).toBe(NOT_FOUND);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Page not found');
  });
});

describe('without a client build', () => {
  it('answers a stats page with the 404 page instead of an error', async () => {
    // makeApp's default build folder does not exist.
    const res = await makeApp().api.get('/stats/anything');

    // The 404 page, with no file path leaked from the failed sendFile.
    expect(res.status).toBe(NOT_FOUND);
    expect(res.text).toContain('Page not found');
  });
});
