// Settings for Vitest, the test runner (npm test).

// defineConfig only adds type checking to the settings object; it changes nothing at run time.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files live in test/ and end in .test.ts.
    include: ['test/**/*.test.ts'],
    // The server runs in Node, so the tests do too (not in a fake browser).
    environment: 'node',
  },
});
