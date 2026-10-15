# Vercel frontend, Railway backend

## Runtime boundary

The Next.js source remains in the existing repository. In Vercel deployments, `next.config.ts` requires `RAILWAY_BACKEND_ORIGIN` and installs `beforeFiles` rewrites for every `/api/:path*` request and `/auth/callback`. These requests are sent to the Railway production service before Next.js route handlers are considered. The origin validator accepts only the configured Eidren Railway production origin. Local development and Railway deployments without `VERCEL=1` retain the existing in-process API routes.

Vercel must not receive API provider tokens, Supabase server-side secret keys, billing credentials, webhook secrets, or other Railway-only secrets. The Vercel landing page obtains its public pricing catalog from Railway's public `GET /api/billing/plans` endpoint, with a static fallback if Railway is unavailable; the privileged database query remains on Railway.

## Vercel project configuration

Create the Vercel project in the `vaelrix` team, linked to `Vaelrixx/eidrencore-svg-mlbb-ign-lookup`, with the repository root as its Next.js project root and `main` as its production branch. Disable preview deployments until a separate nonproduction Railway backend exists; otherwise previews would point at production APIs. Configure this non-secret variable for **Production** before the first build:

```text
RAILWAY_BACKEND_ORIGIN=https://nexus-mlbb-ign-lookup-production.up.railway.app
```

Vercel builds must fail if this value is missing or does not match the approved HTTPS Railway origin. Do not add Railway's `SUPABASE_SECRET_KEY`, `RAZORPAY_*`, game-provider tokens, proxy credentials, or webhook secrets to Vercel.

## Authentication cutover

After the Vercel production hostname is known, set Railway's `APP_URL` to that canonical HTTPS frontend origin. Before switching it, add the Vercel URLs to Supabase Auth's allowed redirects while retaining the existing Railway URLs during the transition:

- `https://<vercel-production-host>/auth/callback`
- `https://<vercel-production-host>/auth/telegram/complete`

Telegram Login also requires registering the Vercel domain and callback URI with the existing Telegram application:

- Domain: `<vercel-production-host>`
- Redirect URI: `https://<vercel-production-host>/api/auth/telegram/callback`

The Razorpay webhook remains on Railway at `https://nexus-mlbb-ign-lookup-production.up.railway.app/api/billing/webhook`. Never move its secret or provider credentials to Vercel.

Do not re-enable Preview deployments until a staging Railway service and isolated auth configuration exist. Validate the public landing page, rewrites and request statuses before any hostname/provider-setting cutover. No client IDs, passwords, keys, or tokens belong in this document.

## Railway serves API only, never UI

Railway is the API backend only. Human-facing pages (`/`, `/login`, `/dashboard/*`, `/playground`, `/forgot-password`, `/reset-password`, `/auth/telegram/complete`) are served exclusively by the Vercel UI deployment. `src/proxy.ts` answers those page routes with `404` on Railway so the UI can never be served from both platforms.

Railway keeps serving `/api/*` plus the auth exchange endpoints that must run beside the secrets: `/auth/callback` (OAuth code exchange) and the `/api/auth/*` token routes. Detection is explicit in `src/lib/deployment-routing.mjs`: `RAILWAY_ENVIRONMENT_NAME` set without any `VERCEL`/`VERCEL_ENV` flag means Railway. Local development sets neither flag, so pages keep rendering locally. Covered by `tests/deployment-routing.test.mjs`.
