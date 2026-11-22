// The first test: proves Vitest, Supertest and the app are wired together correctly.

// describe groups tests, it is one test, expect checks a value.
import { describe, expect, it } from 'vitest';
// A fresh app over an in-memory database, and status codes by name.
import { BAD_REQUEST, makeApp, NOT_FOUND } from './helpers.ts';

describe('unknown API routes', () => {
  it('answer 404 with a JSON error naming the route', async () => {
    // Sends GET /api/nope to a fresh app and waits for the response.
    const res = await makeApp().api.get('/api/nope');

    // "Not found", as JSON rather than Express's HTML page.
    expect(res.status).toBe(NOT_FOUND);
    expect(res.headers['content-type']).toContain('application/json');
    // The message says which method and path had no route.
    expect(res.body).toEqual({ error: 'No route for GET /api/nope' });
  });

  it('answer 400 with a JSON error when the body is not valid JSON', async () => {
    // A broken JSON body, sent with the JSON content type so express.json() tries to parse it.
    const res = await makeApp()
      .api.post('/api/links')
      .set('Content-Type', 'application/json')
      .send('{ not json');

    // The error handler turns the parse failure into a 400 with a JSON body.
    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body).toHaveProperty('error');
  });
});
