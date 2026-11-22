// Settings for Vite, the tool that runs the dev server (npm run dev) and builds client/dist.

// Lets Vite understand JSX and refresh components in place while editing.
import react from '@vitejs/plugin-react'
// A helper that types the settings object; it changes nothing else.
import { defineConfig } from 'vite'

// The Express server's address during development (server/src/index.ts listens on 3000).
const API_SERVER = 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  // Turns the React support on.
  plugins: [react()],
  // Settings for the development server only; the production build ignores them.
  server: {
    // Requests Vite should hand to the Express server instead of answering itself, so the
    // browser sees one origin and no CORS setup is needed.
    proxy: {
      // Every API call.
      '/api': API_SERVER,
      // A short link itself, such as /gym-plan, so a copied link can be tried in development.
      // A key starting with ^ is a regular expression: one slash, then 3 to 30 letters, digits
      // or dashes, and nothing after. Vite's own paths (/src/main.tsx, /@vite/client) and
      // /stats/:code all have a dot, an @ or a second slash, so they never match.
      // Try it: https://regex101.com/?regex=%5E%2F%5BA-Za-z0-9-%5D%7B3%2C30%7D%24&testString=%2Fgym-plan%0A%2Fabc1234%0A%2Fsrc%2Fmain.tsx%0A%2F%40vite%2Fclient%0A%2Fstats%2Fabc1234&flavor=javascript&flags=gm
      '^/[A-Za-z0-9-]{3,30}$': API_SERVER,
    },
  },
})
