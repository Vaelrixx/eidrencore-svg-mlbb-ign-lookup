# Security review — MLBB IGN Lookup

**Review date:** 2026-10-16
**Repository:** `Vaelrixx/eidrencore-svg-mlbb-ign-lookup`
**Base commit:** `19a293b` (`fix: serve UI only from Vercel, Railway answers API only`)
**Remediation branch:** `security/hardening-production-boundaries`

## Executive summary

The production split is behaving as intended: Vercel serves the human-facing UI, while Railway returns 404 for `/` and `/login` and serves API routes. The production UI/API boundary and public plans API were probed with safe GET requests; expected security headers were present on the Vercel UI.

The source review found several hardening gaps and added fixes on the remediation branch: cookie-backed cross-origin mutation protection, stricter post-login redirect validation, DNS-pinned webhook delivery, atomic API-key limits, and removal of trust in caller-supplied `X-Real-IP`. CI now installs from a committed lockfile with `npm ci`.

**The branch is not yet merged or deployed.** At the user's request, the additive key-cap migration was applied to the production Supabase project `Ign-api` before merging. Supabase recorded version `20261016062256`; the repository migration filename is aligned to that version. The PR remains the application-code rollout step. No production application configuration was changed.

## Findings and remediations

| Finding | Risk | Status |
|---|---|---|
| Cookie-backed unsafe requests had no shared same-origin check | A cross-origin site could attempt state-changing actions using a victim's active session, depending on browser/cookie conditions. | **Fixed on branch.** `src/proxy.ts` rejects unsafe cookie-backed requests unless `Origin` or `Referer` matches the canonical app origin. Bearer API-key lookups, the signed Razorpay webhook, and the internal signed dispatcher retain their server-to-server authentication paths. |
| Client and server post-login redirect validation differed | Ambiguous or externally directed `next` values can create open-redirect behavior. | **Fixed on branch.** Login and server redirects now use one strict relative-path validator. |
| Webhook DNS validation was vulnerable to a DNS rebinding gap | A webhook hostname could resolve publicly during validation and privately when the delivery connection was made, creating SSRF exposure. | **Fixed on branch.** The dispatcher validates all DNS answers, rejects unsafe destinations, pins the selected public address for HTTPS, preserves the hostname for TLS, and does not follow redirects. |
| API-key cap used a separate count then insert | Concurrent personal/workspace key-creation requests could exceed the 10-active-key cap. | **Fixed in application code; migration applied to production.** The service-role-only RPC serializes count-and-insert with a transaction-scoped advisory lock and rechecks workspace authorization. PR merge and app deployment remain pending. |
| Rate-limit address selection trusted a valid-looking `X-Real-IP` | A direct caller may set that header on an untrusted path and evade or manipulate IP buckets. | **Fixed on branch.** Auth and lookup throttles ignore `X-Real-IP` and use only the final `X-Forwarded-For` entry, which must be appended by Railway ingress. See residual deployment dependency below. |
| CI dependency installation was not reproducible | Floating package resolution could change between CI runs and made dependency auditing less reliable. | **Fixed on branch.** Added `package-lock.json` and changed CI workflows to `npm ci`. A clean `npm ci` completed successfully. |
| README contained stale migration filenames and callback hosts | Operators could apply the wrong migration or configure redirects against the backend host rather than the Vercel UI. | **Fixed on branch.** README guidance now points to actual migration filenames, Vercel auth redirects, Railway-only secrets, and the direct Railway Razorpay webhook. |

## Database and authentication posture

- The inspected application tables have RLS enabled, and `anon`/`authenticated` table grants are revoked. The advisor's missing-policy warnings therefore appear fail-closed for direct client access rather than evidence of public table access.
- Server routes use the Supabase service-role credential, which bypasses RLS. This is an intentional server-side pattern, but it makes route-level authentication, ownership checks, and secret isolation critical; do not expose service credentials to Vercel/browser code.
- The Supabase Auth advisor reported compromised/leaked-password protection disabled. The repository documents this as unavailable on the current Supabase free tier. The app's local password-strength policy and throttling are not a substitute for checking a breach corpus; enable the Supabase feature if the project plan permits it.
- The migration `20261016062256_atomic_api_key_cap.sql` is recorded in production. It is additive and does not delete or rewrite existing API keys. The repository filename is aligned to the database's recorded version; future deployments should confirm migration history before applying.

## Residual risks and deployment checks

1. **Trusted proxy requirement:** IP throttles now rely on Railway appending the real client address as the final `X-Forwarded-For` item. Verify this ingress behavior on both direct Railway requests and requests proxied through Vercel. Do not put the backend behind an unmanaged proxy that preserves caller-supplied forwarding headers; when no trusted address is present, the IP limiter is disabled.
2. **Limiter degradation policy:** The lookup and playground IP/account limiters intentionally fail open if required configuration is missing or their Supabase RPC is unavailable. API-key plan quota enforcement is a separate control. Auth throttling fails closed when configured but the database call fails; missing configuration or missing trusted IP disables that extra limiter, leaving Supabase's own edge limits as the fallback. Decide explicitly whether the lookup limiter's availability-first behavior is acceptable.
3. **Compromised-password protection:** Supabase's breached-password check remains disabled until enabled in the Supabase project; local password strength checks do not provide breached-password detection.
4. **Application rollout:** The database RPC is already installed and verified. Merge PR #72, then verify the application deployment and key-creation paths; the application code is not active in production until deployment completes.

## Validation performed

- **Production read-only smoke:** Vercel `/` and `/login` returned HTTP 200; Railway `/` and `/login` returned HTTP 404; Railway `/api/billing/plans` and the Vercel-rewritten `/api/billing/plans` returned HTTP 200. Vercel exposed CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy` headers.
- **Automated tests:** All 11 project test scripts passed, including 238 tests overall; the auth, persistence, and new security suites were rerun after the final `X-Real-IP` change.
- **TypeScript:** `npx tsc --noEmit` passed.
- **Build:** `npm run build` passed.
- **Lint:** 0 errors; 5 existing UI warnings remain (purity/render-time `Date` and array-index-key warnings).
- **Dependency audit:** `npm audit` and `npm audit --omit=dev` both reported 0 vulnerabilities.
- **Semgrep:** `p/security-audit` reported 0 findings and 0 parser errors on the remediation files.
- **Diff hygiene:** `git diff --check` passed.
- **Production schema:** Supabase migration history records `20261016062256_atomic_api_key_cap`; RPC is `SECURITY DEFINER` with empty `search_path`, executable by `service_role`, and not executable by `anon` or `authenticated`.

The production smoke checks describe the currently deployed revision; they do not prove that the unmerged remediations are active in production.
