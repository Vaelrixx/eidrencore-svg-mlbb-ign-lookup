# MLBB IGN Lookup — Full Project Analysis
**Repo:** [Vaelrixx/eidrencore-svg-mlbb-ign-lookup](https://github.com/Vaelrixx/eidrencore-svg-mlbb-ign-lookup) · `main` @ `7e7896b` · 239 commits · 227 files · TypeScript/Next.js · Public, 1★
**Analyzed:** 2026-10-16. Local clone: `/home/ubuntu/mlbb-review`

---

## 1. What this project is

Started 2026-10-10 as an **MLBB (Mobile Legends) IGN lookup** site. In ~6 days it grew into **"Eidren" — a multi-game player-identity lookup developer platform / SaaS**:
- 25+ game lookup routes (MLBB, Free Fire, Genshin, HSR, ZZZ, CoD:M, PUBG, Valorant, FC Mobile, Clash of Clans/Royale, Brawl Stars, Genshin, HoK, AoV, Jawaker, Teen Patti Gold, Bigo Live, Higgs Domino, …)
- Developer platform: API keys, workspaces + members/invites, usage metering, request logs, audit logs, webhooks (durable outbox), docs + playground
- Monetization: Razorpay one-time + recurring billing, free/pro/business tiers
- Auth: Supabase Auth (email/password, Telegram Login, OAuth providers)

## 2. Split deployment (Vercel UI ↔ Railway backend)

| Layer | Platform | Project / Service | URL | State |
|---|---|---|---|---|
| **UI (frontend only)** | Vercel (`vaelrix` team, hobby) | `eidrencore-ui` (`prj_vg22…`) | https://eidrencore-ui.vercel.app | READY, commit `7e7896b` (= main HEAD) |
| **Backend (full Next.js, API only)** | Railway (`ign-api` project) | `nexus-mlbb-ign-lookup` (1 replica, `iad`) | https://nexus-mlbb-ign-lookup-production.up.railway.app | SUCCESS deploy `f0be8bd9`, 2026-10-15 19:46 UTC, commit `7e7896b` |
| **Database** | Supabase | `Ign-api` (`boayekgqwh…`), ap-northeast-1, Postgres 17, ACTIVE_HEALTHY | `db.boayekgqwhjywsobylor.supabase.co` | live, 16 tables, RLS on |

How the split works (`docs/vercel-railway-hosting.md`): Vercel **requires `RAILWAY_BACKEND_ORIGIN`** and rewrites **all `/api/:path*` + `/auth/callback`** to Railway before Next.js handlers run. **No secrets on Vercel** — provider tokens, `SUPABASE_SECRET_KEY`, Razorpay/webhook secrets stay Railway-only. Vercel pricing page reads public `GET /api/billing/plans` from Railway with static fallback. Preview deploys are intentionally disabled until a staging backend exists. Razorpay webhook stays on Railway.

**Live probes (2026-10-16):** Railway `/` → 200 (~13s cold), `/api/billing/plans` → live plans JSON (free ₹0/100 calls, pro ₹499/10k, business ₹1499/100k). Vercel `/` → 200 (~1.4s). Railway 1h error rate: **0.00%** (63 req, 0 5xx, 0 4xx).

## 3. Source code architecture (`mlbb-ign-lookup`, Next 16.4 / React 19)

- **Deps (lean):** `next`, `react`, `@supabase/ssr` + `supabase-js`, `jose`, `lucide-react`, `server-only`. No ORM (raw SQL via Supabase), no Tailwind dep listed at top level.
- **Routes:** 17 pages (landing, login, forgot/reset-password, public playground, Telegram complete, dashboard: overview/playground/keys/usage/logs/billing/account/docs/webhooks/workspaces) + **~60 API routes**: 25+ `api/lookup/*` game routes, auth (password/reset/signout/Telegram/OAuth), billing (plans/checkout/verify/webhook/cancel/me), keys CRUD, usage, workspaces (+ nested billing/keys/members), webhooks (+ retry), developer-logs, internal webhook dispatch.
- **Lookup engine:** provider adapters with fallback chains (`tests/` has per-provider suites: RapidAPI games + variants, Whoplays, Gopay games, Jawaker `verify_user`, Enka for Genshin/HSR/ZZZ, Supercell official APIs). Outcome normalization + reliability tests. External keys on Railway: `RAPIDAPI_KEY`, `WHOPLAYS_API_KEY`, Brawl/CoC/CR keys, `FIXIE_URL` egress proxy, `PROBE_BEARER`.
- **Auth:** Supabase Auth + `src/proxy.ts` middleware, `src/lib/session.ts`, `src/lib/supabase/`; Telegram Login with bot ID/secret; OAuth `[provider]` route.
- **Billing:** Razorpay checkout/verify/webhook + subscription utils, pending-plan double-write pattern (`pending_order_id` → activate on webhook), workspace-level billing mirror.
- **Tests:** 31 suites (`node --test`), split by area: lookup-safety, provider-adapters, provider-sweep:live, persistence, billing, auth, observability, deployment-routing, TS client. Live-contract tests need real keys.

## 4. Database (`Ign-api`, 16 tables, all RLS-on)

| Table | Rows | Role |
|---|---|---|
| `lookup_logs` | 79 | rate-limit/audit log of lookups (status enum, response_ms) |
| `usage_limits` | 31 | per-client rate-limit windows |
| `api_keys` | 8 | hashed keys (sha256 `key_hash`), prefixes, per-key plan, workspace link |
| `developer_plans` | 3 | free/pro/business tiers |
| `developer_subscriptions` | 5 | per-user Razorpay state machine (free/pending/active/past_due/cancelled) |
| `developer_api_usage` / `_daily` | 3 / 6 | monthly + daily metering per key |
| `developer_api_request_logs` | 69 | per-request log (endpoint, status, latency) |
| `developer_audit_logs` | 4 | workspace audit trail |
| `developer_workspaces` / `_members` / `_invites` / `_subscriptions` | 0 | team workspaces — **schema shipped, unused** |
| `developer_webhook_endpoints` / `_deliveries` / `_outbox` | 0 | durable webhooks — **schema shipped, unused** |

8 migrations, all Oct 10–12 (rate-limit → developer platform → analytics → workspaces/audit/webhooks → indexes → durable webhooks/billing → signup provisioning → Razorpay recurring). FK graph is clean: keys→users/plans/workspaces, usage→keys, subscriptions→users/plans, webhook chain endpoint→outbox→deliveries.

## 5. Git history, PRs, commits

- **239 commits** since Oct 10 (~40/day), 3 contributors: Vaelrix (430, `avenixlabss@`), Vaelrixx (37, noreply), eidrencore-svg (14), Claude (10, Anthropic — AI-assisted).
- **70 PRs total, 69 merged, 1 open:** #69 `fix/codm-id-echo-guard` ("Reject CODM identity lookups that echo the player ID", opened Oct 15).
- **Branch hygiene is poor:** ~60 remote branches, most merged but unpruned (incl. `TEMP:` probe branches like `chore/temp-final-wi009-probe`, `test/*-20261010` sweeps). No tags.
- **Recent arc:** game-expansion wave (Oct 12: AoV, PUBG Lite, TPG/Jawaker/FC Mobile, FF/Bigo/Higgs, HSR/ZZZ) → auth/CSP fix (#67) → lookup hardening (#68) → **UI/backend split (#70, HEAD)** → CODM guard (#69, open).
- Railway keeps last 10 deploys (latest SUCCESS, older REMOVED); Vercel shows only the 1 production deploy.

## 5b. Railway backend env (20 vars, names only)

`APP_ENCRYPTION_KEY`, `APP_URL`, game keys (Brawl/CoC/CR/RapidAPI/Whoplays), `FIXIE_URL`, `LOOKUP_RATE_LIMIT_SECRET`, `PROBE_BEARER`, Razorpay ×3, Supabase ×3, Telegram ×3, `WEBHOOK_WORKER_SECRET`. All secrets correctly Railway-side.

## 6. Strengths

- Clean split-hosting design with documented secret boundary; build fails closed without `RAILWAY_BACKEND_ORIGIN`.
- Real SaaS spine: key hashing (never plaintext), dual usage metering, durable webhook outbox (8 attempts + dead-letter), audit logs, workspace RBAC schema.
- Good test segmentation incl. live-contract + outcome-normalization suites; false-positive guards (CODM echo, ambiguous nicknames → unavailable).
- Both deploys green, 0% backend errors, live billing endpoint verified.

## 7. Risks / tech debt (for us to work on)

1. **~60 stale merged branches** — prune (`git branch --merged main`), keep probes out of history or squash.
2. **Dead schema:** workspaces + webhooks tables are all at 0 rows — either wire up or defer; don't let them rot.
3. **Single-region single-replica backend** (`iad` ×1) + hobby Vercel — no HA; Tokyo DB ↔ Virginia backend adds latency (13s cold root observed).
4. **Preview deploys disabled** — safe but slows UI iteration; needs staging Railway + isolated auth (documented, not done).
5. **#69 open (CODM echo guard)** — merge or close; small, test-covered.
6. **Secret sprawl surface:** 20 Railway vars incl. game API keys — rotate on a schedule; confirm `APP_URL`/Supabase/Telegram redirect cutover to Vercel hostname is done.
7. **No tags/releases** — cut `v0.1.0` at the split commit for a rollback anchor.
8. Watch: `lookup_logs.source` default `'codashop_validation'` suggests legacy semantics; `usage_limits` (31 rows) vs `developer_api_usage` dual metering — confirm single source of truth for limits.

## 8. Suggested next steps

- [ ] Merge/close #69, prune merged branches, tag `v0.1.0`
- [ ] Verify `APP_URL` + Supabase allowed-redirects + Telegram domain point at Vercel host
- [ ] Decide: activate workspaces/webhooks (migrate data model usage) or park them
- [ ] Add staging Railway env + enable Vercel previews against it
- [ ] Run `test:provider-sweep:live` + `test:persistence` before next game addition
- [ ] Set up error alerting (Railway HTTP 5xx + Vercel runtime errors) — currently only manual checks
