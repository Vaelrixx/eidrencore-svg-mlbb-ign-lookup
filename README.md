# Eidren — MLBB IGN Lookup

Standalone Next.js + TypeScript API for resolving Mobile Legends: Bang Bang nicknames from a Player ID and Zone ID.

The service owns input validation, provider orchestration, response normalization, and deployment. It uses a primary community lookup and best-effort fallback providers, including RapidAPI's ID Game Checker when `RAPIDAPI_KEY` (or the legacy `RAPIDAPI_APP_TOKEN`) is configured.

These integrations are unofficial third-party endpoints, not an official Moonton API. Their contracts and availability can change. The RapidAPI adapter uses the provider's documented `mobile-legends` game slug rather than the former `mlbb` path. RapidAPI ID Game Checker uses its documented response body to distinguish an explicit `id_not_found` result from `no_content_0` (provider could not retrieve source data); an HTTP 404 without the documented body remains an upstream-unavailable result. Provider failures and timeouts are **not** treated as proof that an account is invalid.

## Run locally

Requires Node.js 20.9+.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## API

`GET /api/lookup?playerId=123456789&zoneId=1234` or `POST /api/lookup`

Opening `/api/lookup` in a browser with no query parameters returns service status and usage examples. For a browser-based lookup, pass both IDs as query parameters:

```text
/api/lookup?playerId=1114917746&zoneId=13486
```

For server-to-server usage, send JSON with POST:

```json
{ "playerId": "123456789", "zoneId": "1234" }
```

Successful response:

```json
{
  "success": true,
  "data": {
    "nickname": "ExampleNickname",
    "playerId": "123456789",
    "zoneId": "1234",
    "source": "community_lookup"
  }
}
```

Error responses preserve a stable `{ success: false, error, code }` shape. Common codes include `INVALID_JSON`, `INVALID_INPUT`, `INVALID_ID`, `PLAYER_NOT_FOUND`, `UPSTREAM_RATE_LIMIT`, `RATE_LIMITED`, and `UPSTREAM_UNAVAILABLE`. Every POST response includes an `X-Lookup-Request-Id` header for correlating a caller's result with sanitized server-side provider diagnostics without logging player identifiers.

A success is returned only when a provider returns a plausible nickname in a recognized response field. Generic error text is rejected. The primary provider is attempted first. If it cannot confirm a nickname, only the currently validated Isan and RapidAPI adapters run concurrently; the first confirmed nickname is returned without waiting for slower attempts. If no fallback confirms a nickname, the route waits for all results before deciding whether the account is not found or the providers are unavailable. Unreliable 403/500 sources and the Codashop checkout-initialization endpoint are not called by the production lookup path.

## Production configuration

The following server-only environment variables enable persistent logging and distributed rate limiting:

- `SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_SECRET_KEY` (preferred) or `SUPABASE_SERVICE_ROLE_KEY`: a server-only Supabase secret/service-role key. Never prefix it with `NEXT_PUBLIC_` or expose it to browser code.
- `LOOKUP_RATE_LIMIT_SECRET`: a long, random secret used to HMAC client addresses before storing rate-limit keys. Keep it separate from the Supabase key.

Without `SUPABASE_URL` and a server-only Supabase key, database logging and shared rate limiting are disabled and the API continues to operate as before. Without `LOOKUP_RATE_LIMIT_SECRET` or a trusted ingress client address, only the limiter is disabled; persistent logging can still operate. If the database is temporarily unavailable, the limiter fails open and emits only a bounded degradation event; database logging is best-effort and cannot change lookup results. The deployment owner must configure these values and apply the checked-in migration before enabling the features.

The limiter uses an atomic Postgres RPC against `usage_limits`, with a default limit of 30 requests per client per 60-second window. The function clamps counts and window sizes, is callable only by `service_role`, and uses the existing table's RLS/grants without adding public policies. The API hashes the trusted ingress client address with HMAC-SHA-256; it does not store the raw address or HMAC secret. Ensure Railway's ingress controls `X-Real-IP` / `X-Forwarded-For` as documented for the deployed proxy chain.

Persistent `lookup_logs` rows contain only a bounded status (`success`, `invalid_input`, `not_found`, `upstream_error`, or `rate_limited`), response duration, and allowlisted source label. Player IDs, zone IDs, nicknames, request IDs, client hashes, upstream payloads, URLs, headers, and credentials are not written to the table. Existing provider diagnostics remain structured and privacy-safe in Railway logs.

## Provider observability

Production logs emit structured JSON events for each provider attempt and each completed lookup. Provider events include a request correlation ID, provider label, outcome, latency in milliseconds, and the selected source only on success. Failed attempts may also include a bounded failure reason (`missing_config`, `http_error`, `network_or_timeout`, `unrecognized_response`, or `provider_error`) and an upstream HTTP status code. RapidAPI diagnostics may also include a low-cardinality response-shape label; raw content is never logged. The summary records total duration and outcome counts. Player IDs, zone IDs, nicknames, upstream payloads, URLs, request headers, and credentials are intentionally excluded. Logging is best-effort and cannot change lookup results. Use Railway deployment logs to compare provider latency and availability over time; these are event logs, not a persistent metrics dashboard.

Run `npm run test:provider-adapters` to cover RapidAPI response classification, including structured 404 handling and `no_content_0`. Run `npm run test:observability` to check telemetry privacy and failure isolation. Run `npm run test:persistence` to cover the shared limiter and sanitized Supabase logging payloads.

## Live fallback takeover smoke test

Run `npm run test:lookup:live` to simulate an unavailable primary and call the real Isan secondary adapter through the same resolver used by the API route. It reports the selected source, returned nickname, and elapsed time. This test requires network access and a working response from the third-party Isan service; it is separate from deterministic unit tests and does not modify production.

## Manual live provider sweep

Run `npm run test:provider-sweep:live` or trigger the **Live provider diagnostic sweep** workflow in GitHub Actions. It probes the known-valid test fixture against the Isan secondary adapter, EliteDias, Smile.One, and the current form-encoded, current JSON, and an older public-reference JSON inquiry parameter set for Dunia Games (diagnostic only). ID Game Checker is probed only when `RAPIDAPI_KEY` or `RAPIDAPI_APP_TOKEN` is configured in the workflow environment; production's Railway secret is not copied into GitHub Actions.

The sweep logs provider labels, sanitized outcome categories, HTTP status codes, durations, allowlisted response-shape/key names, and bounded provider-code/error-category fields. It never prints IDs, nicknames, response values, message text, URLs, request headers, or credentials. It intentionally skips Codashop's `initPayment` endpoint because that can create a checkout session.

The older Dunia Games reference variant is taken from a public unofficial implementation at [namtxs/DuniaGames](https://github.com/namtxs/DuniaGames/blob/main/src/duniaGames.php). It is only probed by the diagnostic workflow; production keeps its existing parameters unless a known-valid test proves the alternate set works.


## Developer platform (new)

The developer console lives at `/login` and `/dashboard`. It supports email/password and OAuth sign-in with Google, GitHub, Discord, and Telegram OpenID Connect. Social login is only active after the provider credentials and callback URLs below are configured.

### Required Railway environment variables

- `APP_URL` (recommended): canonical public HTTPS origin used for auth, OAuth, and recovery redirects. Defaults to the Railway production URL; set it when using a custom domain. Localhost HTTP is allowed for local development.\n- `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_PUBLISHABLE_KEY` (already used by the existing service): public/publishable key used by cookie-based auth. `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are optional because sign-in and dashboard auth are routed through server handlers.
- `SUPABASE_SECRET_KEY` (preferred) or `SUPABASE_SERVICE_ROLE_KEY`: server-only key for API-key management and billing. Never prefix this key with `NEXT_PUBLIC_`.
- `TELEGRAM_CLIENT_ID` (or `TELEGRAM_BOT_ID`) and `TELEGRAM_CLIENT_SECRET`: Telegram Login credentials from @BotFather. The secret stays server-side.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`: Razorpay Checkout and webhook credentials.
- Optional plan defaults: `RAZORPAY_PRO_PRICE_PAISE`, `RAZORPAY_BUSINESS_PRICE_PAISE`, `PLAN_PRO_MONTHLY_LIMIT`, `PLAN_BUSINESS_MONTHLY_LIMIT`. The database plan catalog is authoritative after migration.

### Provider dashboard configuration

- In Supabase Auth > URL Configuration, set the Site URL to the Railway production URL and add `https://nexus-mlbb-ign-lookup-production.up.railway.app/auth/callback` to allowed redirect URLs. Also allow the Telegram completion URL `https://nexus-mlbb-ign-lookup-production.up.railway.app/auth/telegram/complete`.
- In Supabase Auth > Providers, enable Google, GitHub, and Discord, and enter each provider's client ID/secret. Register the Supabase callback URL shown in that provider's settings (usually `https://<project-ref>.supabase.co/auth/v1/callback`) with each OAuth provider. The app callback is `/auth/callback`.
- For Telegram, use @BotFather > Login Widget to register the production domain and the redirect URI `https://nexus-mlbb-ign-lookup-production.up.railway.app/api/auth/telegram/callback`. Use the provided Client ID and Client Secret as `TELEGRAM_CLIENT_ID` and `TELEGRAM_CLIENT_SECRET`. The Telegram OIDC flow uses state, nonce, PKCE, and server-side ID-token signature validation.
- In Razorpay, configure the webhook URL `https://nexus-mlbb-ign-lookup-production.up.railway.app/api/billing/webhook` and subscribe to `payment.captured` and `order.paid`. Copy its webhook secret to Railway. Use test-mode credentials before going live.

### Database and plans

Apply `supabase/migrations/20261010210000_developer_platform.sql` after reviewing it. It creates the plan catalog, hashed API-key records, subscription state, monthly quota counters, and a quota-consumption RPC. All platform tables have RLS enabled and direct client grants revoked; server routes use the server-only Supabase secret and verify the signed-in user before acting on their records.

The Free plan starts at 100 API calls/month. Paid plans are disabled by default and have zero prices until you configure them. The current Razorpay MVP grants a verified 30-day access period after a one-time payment; it does not automatically renew or charge a saved payment method. In Supabase SQL Editor, set the price in paise and enable the chosen plan, for example:

```sql
update public.developer_plans
set price_paise = 49900, enabled = true, monthly_limit = 10000, updated_at = now()
where slug = 'pro';

update public.developer_plans
set price_paise = 149900, enabled = true, monthly_limit = 100000, updated_at = now()
where slug = 'business';
```

These example prices are illustrative only; choose your actual pricing before enabling paid checkout. Razorpay verifies the checkout signature and fetches the payment to confirm it is captured before activating the plan. The webhook signature is independently verified. API keys are generated from cryptographic randomness, stored as SHA-256 hashes, shown once, and can be revoked. Paid keys receive monthly quotas from the active plan; public lookup requests without an Eidren API key remain available under the existing IP rate limit.

Telegram sign-in creates an internal Supabase user with a non-routable synthetic email because Telegram does not provide an email by default. Users should not rely on email password recovery for Telegram-only accounts; account linking and account deletion UI are not included in this first platform pass.


## Developer console expansion

The console is split into dedicated areas under /dashboard:

- **Overview** — account, plan, quota, and quick actions.
- **API keys** — create, label, copy once, and revoke keys.
- **Usage & analytics** — current-month quota, per-key activity, and a 14-day request chart.
- **API reference** — cURL and Node.js examples, request fields, and error codes.
- **Billing & plans** — current plan and Razorpay checkout.
- **Account & sessions** — account metadata, current session expiry, password updates, and provider-wide session revocation.
- **Password recovery** — /forgot-password and /reset-password for email/password accounts.

### Daily analytics migration

Apply supabase/migrations/20261011090000_daily_api_analytics.sql to the linked Supabase project before expecting the 14-day usage chart to populate. It creates developer_api_usage_daily and replaces the quota RPC with a transactionally updated daily counter. Only accepted API-key requests are added to the daily chart; quota-rejected requests are not counted as successful usage. The table has RLS enabled and is accessible only to the server-side service_role.

The account page intentionally shows the current session rather than claiming to list every device. “Revoke all sessions” delegates to Supabase Auth's global sign-out scope. Password reset links must be allowed by the project's Supabase Auth URL configuration and email delivery must be configured.


## Team workspaces, webhooks, and audit logs

The developer console includes new sections at:

- `/dashboard/workspaces` — create workspaces, view members, invite by a single-use seven-day link, and remove members.
- `/dashboard/webhooks` — register public HTTPS endpoints, select event types, pause/delete endpoints, and review recent delivery attempts.
- `/dashboard/logs` — view recent authenticated API request records and administrative audit events.

### Database migration

Apply `supabase/migrations/20261011120000_workspace_audit_webhooks.sql` to the linked Supabase project before deploying these routes. It creates workspace, membership, invitation, audit, webhook endpoint, delivery, and sanitized API request log tables. RLS is enabled on all new tables, and `anon`/`authenticated` table access is revoked; the server uses its secret role only after verifying the current user in the route.

### Required Railway secret

Set `APP_ENCRYPTION_KEY` to a unique cryptographically random secret of at least 32 characters before creating webhook endpoints. The application uses AES-256-GCM to encrypt webhook signing secrets at rest. Do not reuse a Razorpay secret or expose this value to client code.

Webhook requests contain `Eidren-Event-Id`, `Eidren-Event`, and `Eidren-Signature` headers. The signature is HMAC-SHA256 over `timestamp + "." + raw JSON body` and is formatted as `t=<unix timestamp>,v1=<hex digest>`. Consumers should compare signatures in constant time and reject stale timestamps. Endpoints must be HTTPS; private/special-use IP literals and hostnames resolving to non-public IPv4 addresses are rejected. DNS-based egress filtering should still be enforced at the network layer in hardened production environments.

### Scope and current limitations

- Workspaces manage members, but existing API keys remain owned by their creator. Shared workspace keys and shared billing are not yet implemented.
- Invitation links are generated for manual delivery; SMTP/email sending is not configured.
- Webhook attempts are sent synchronously with a short timeout and logged. Durable queueing, exponential retry, dead-letter handling, and replay controls are follow-up work.
- API request logs include request ID, endpoint, status, latency, key reference, and timestamp. They deliberately exclude player/zone IDs, nicknames, bearer keys, and webhook secrets. Logs start after this release is deployed; historic traffic cannot be backfilled.
