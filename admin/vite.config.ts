import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/*
 * Admin SPA build. Tailwind v4 via the Vite plugin (same setup as the site),
 * plus the React plugin so Fast Refresh works during UI work.
 *
 * `npm run dev` serves the SPA on :5174 and proxies `/api` to the local
 * Functions server from `npm run dev:cms` on :8788. Run both terminals; the
 * proxy means the SPA and the API share an origin, so cookies (and the local
 * `DEV_USER_EMAIL` bypass) behave exactly as they do in production.
 */
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8788',
        changeOrigin: false,
      },
    },
  },
})
