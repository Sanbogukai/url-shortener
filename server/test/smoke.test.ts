// The first test: proves Vitest, Supertest and the app are wired together correctly.

// describe groups tests, it is one test, expect checks a value.
import { describe, expect, it } from 'vitest';
// Supertest sends HTTP requests straight to an Express app, without opening a port.
import request from 'supertest';
// The app under test.
import { createApp } from '../src/app.ts';

describe('unknown API routes', () => {
  it('answer 404 with a JSON error naming the route', async () => {
    // Sends GET /api/nope to a fresh app and waits for the response.
    const res = await request(createApp()).get('/api/nope');

    // "Not found", as JSON rather than Express's HTML page.
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    // The message says which method and path had no route.
    expect(res.body).toEqual({ error: 'No route for GET /api/nope' });
  });

  it('answer 400 with a JSON error when the body is not valid JSON', async () => {
    // A broken JSON body, sent with the JSON content type so express.json() tries to parse it.
    const res = await request(createApp())
      .post('/api/nope')
      .set('Content-Type', 'application/json')
      .send('{ not json');

    // The error handler turns the parse failure into a 400 with a JSON body.
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
