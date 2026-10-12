# Operator runbook: Eidren identity network providers

> **Internal only.** This document describes what the Eidren network is made
> of. It is intentionally NOT linked from the README, the dashboard docs, the
> landing page, or any customer-facing surface. Do not quote provider names,
> proxy hosts, or key signup flows in customer communications — customers see
> only `eidren_*` sources and `SERVICE_*` error codes.

## MLBB lookup chain (`/api/lookup`)

Primary-first with concurrent fallbacks (`resolveLookupWithFallbacks`). The
first confirmed nickname wins; if none confirms, the route waits for every
result before deciding not-found vs. unavailable.

| Role | Adapter | Server labels | Auth |
|---|---|---|---|
| Primary | `src/app/api/lookup/route.ts` → `lookupPrimary` | `isan_find` / `community_lookup` | None — `https://mlbb-api.isan.eu.org/find` |
| Fallback 1 | `providers/rapidapi.mjs` | `rapidapi_id_game_checker` | `RAPIDAPI_KEY` (or legacy `RAPIDAPI_APP_TOKEN`) |
| Fallback 2 | `providers/isan.mjs` | `isan_nickname_api` | None — `https://api.isan.eu.org/nickname/ml` |
| Fallback 3 | `providers/whoplays.mjs` | `whoplays_check` | `WHOPLAYS_API_KEY` from whoplays.doedja.com/dashboard (free: 30/min) |
| Fallback 4 | `providers/gopay-games.mjs` | `gopay_games_validation` | None — direct JSON validation endpoint |

Contract notes:

- RapidAPI uses the documented `mobile-legends` slug. Only the structured
  `id_not_found` body counts as not-found; `no_content_0` is unavailable.
- WhoPlays: only `error: "not_found"` (HTTP 422) counts as not-found.
  `unauthorized` / `parse` / `upstream` degrade to unavailable so a bad key
  never poisons the all-not-found verdict.
- GoPay Games: HTTP 404 counts as not-found only when the response also has
  `statusCode: 404`, `error: "Not Found"`, and a message beginning
  `Invalid User Account:`. Unknown 404 bodies remain unavailable. Success
  requires the observed `message: "Success"` envelope and a confirmed
  `data.username` nickname. The endpoint is a secondary Codashop-family data
  path, so treat it as operationally separate, not data-lineage independent.
- Missing keyed-provider keys degrade to `missing_config` without fetching.
- Customer-facing source is always `eidren_mlbb` regardless of adapter.

## Identity lookups (`/api/lookup/{pubg-mobile,call-of-duty-mobile,valorant,genshin-impact,honor-of-kings}`)

Single RapidAPI adapter per game through `providers/rapidapi-games.mjs`, classified by
`classifyRapidApiGameResponse`. Customer-facing sources are `eidren_*` per game.
HoK/Genshin went 502 on HTTP 200 `id_game_checker_schema` bodies in production on
2026-10-12 while PUBG/CODM succeeded, which pointed at per-game envelope variants
rather than a key/gateway outage. The game classifier therefore accepts these variants:

- Missing accounts: an error flag plus a normalized not-found message resolves as
  `not_found` regardless of the embedded provider status; an error flag with an
  embedded 404 also resolves as `not_found` even when the message text is unfamiliar.
- Degraded upstreams (`no_content_0`, temporary/maintenance/timeout/rate wording)
  stay `unavailable` with `provider_error`, never `not_found`.
- Success extraction accepts nested `profile`/`player`/`user`/`account` objects and
  alternate nickname keys (`displayName`, `nickName`, `accountName`, `characterName`,
  and similar) under the existing placeholder guard.
- Unrecognized or degraded failures attach a PII-free `providerResponseShape` label
  (envelope keys plus allowlisted `data` keys only). Unknown keys collapse to
  `data:object:unlisted_keys`; values are never logged.

## Supercell lookups (`/api/lookup/{brawl-stars,clash-of-clans,clash-royale}`)

Single-adapter per game through the RoyaleAPI community proxy
(`docs.royaleapi.com/proxy.html`). Customer-facing sources are
`eidren_brawl_stars`, `eidren_clash_of_clans`, `eidren_clash_royale`.

Configure the per-game server-only Railway variables:

- `BRAWL_STARS_API_KEY` from developer.brawlstars.com
- `CLASH_OF_CLANS_API_KEY` from developer.clashofclans.com
- `CLASH_ROYALE_API_KEY` from developer.clashroyale.com

When creating each key, allowlist RoyaleAPI's proxy IP `45.79.218.79`.
Eidren sends each key as a bearer token to the corresponding RoyaleAPI
proxy host. These lookups do not use Fixie. Optional `*_API_BASE` variables
override the API base; keep overrides server-side and compatible with the
key's IP allowlist. A missing game key logs `missing_config` server-side and
returns the generic `SERVICE_UNAVAILABLE` (502) to customers — the operator
signal stays in Railway logs, never in the API response.

## Diagnostics

- `npm run test:provider-adapters` — RapidAPI, WhoPlays, and GoPay response
  classification plus request-contract unit tests.
- `RUN_LIVE_PROVIDER_CONTRACTS=1 npm run test:provider-sweep:live` — also runs
  the opt-in GoPay valid/invalid contract checks. It sends only two read-only
  identity lookups to the observed validation endpoint; no order/payment call.
- `npm run test:provider-sweep:live` — live sweep against the known-valid
  fixture (`1114917746` / `13486` → "Outrageous Dominance"). Keyed
  providers probe only when their keys are in the workflow environment;
  Railway secrets are never copied into GitHub Actions. Diagnostic-only
  probes include EliteDias, Smile.One, and Dunia Games inquiry variants.
  Never print IDs, nicknames, URLs, headers, or credentials from the sweep.
- `npm run test:lookup:live` — fallback-takeover smoke test through the
  production resolver.
- Railway deploy logs carry structured per-provider JSON (label, outcome,
  latency, bounded failure reason). Raw payloads and credentials are never
  logged.

## Deliberately excluded

- Codashop `initPayment` — can create a checkout session; diagnostic and
  production paths must not call it.
- EliteDias / Smile.One / DuniaGames — failed the live sweep (invalid
  verdicts, bot redirects, HTTP 500); diagnostic-only.
- REDX Game — its public checker was exercised through the normal browser form
  and returned the fixture nickname. The form uses a CSRF token and POSTs to
  `/tools/check`; keep it diagnostic-only until the server-to-server contract
  and direct production egress are independently proven. Do not bypass its
  browser protections.
- MaxwellGG — public handler requires a page-issued `checkToken`; its checker
  contract was not live-verified. Do not integrate from source inspection only.
- VocaGame — its product page contains purchase-flow fields; no checkout or
  payment action was invoked, and it is not treated as a lookup backup.
