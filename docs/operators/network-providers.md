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
  `data:object:unlisted_keys`; values are never logged. Degraded and unrecognized
  failures also attach an allowlisted `providerMessageCode` (`msg`/`code` normalized
  to a known token, else `unlisted`, else `absent`); raw provider text is never logged.
  Per-game `no_content_N` codes collapse to `no_content_n`.
- Live HoK/Genshin evidence (2026-10-12 probe): both routes return HTTP 200 with
  `error:false`, embedded `status:204`, per-game codes `no_content_2` (HoK) and
  `no_content_5` (Genshin), and an empty `data.username`. HoK `data` also carries
  an `is_ban` flag. These classify as `provider_error`/unavailable — the same
  degraded treatment as MLBB `no_content_0` — and never as not-found or
  unrecognized. Final probe (2026-10-13, E-003) settled HoK: the provider-docs
  alternate ID returns `id_found` with a username, so the HoK route is healthy
  and the original sample ID was dead — the playground sample is now the working
  docs ID. Genshin returned `no_content_5`/empty on all four documented servers
  for the single published UID, and user retries across several UIDs kept
  returning the same empty envelope — the keyed feed's Genshin data is dead,
  not the samples. Resolution (WI-012): `lookupGenshinWithFallback` chains the
  keyed primary first, then the keyless showcase fallback
  (`GET https://enka.network/api/uid/{uid}/?info`, `EidrenIdentityLookup/1.0`
  User-Agent, 10s timeout, no retry). Success/not-found/rate-limit verdicts
  are terminal per stage; only degraded primary outcomes fall through.
  Contract: 200 + `playerInfo.nickname` = success, 404 = not-found,
  400 = invalid input (never not-found), 429 = rate-limited, 424/5xx =
  degraded. Public source stays `eidren_genshin_impact` either way. Respect
  Enka rules: custom User-Agent, no UID enumeration or bulk jobs, low-volume
  contracted use only.
- Identity fetches use a 15s timeout with one retry after 800ms for transport
  failures only. The retry does not repeat on explicit not-found, rate limits, or
  degraded provider bodies. Post-#53 production evidence: HoK hit the old 7s timeout
  (`network_or_timeout`, 7004ms) while Genshin returned a degraded
  `id_game_checker_schema` body (`provider_error`, shape
  `envelope:data,error,msg,status|data:object:id,server,username`), so the retry
  targets HoK-class slowness and the message code targets Genshin-class degradation.

## Supercell lookups (`/api/lookup/{brawl-stars,clash-of-clans,clash-royale}`)

Hardened primary/secondary chain per game (Phase 1): official direct host
first (`api.brawlstars.com`, `api.clashofclans.com`, `api.clashroyale.com`),
failing over to the RoyaleAPI community proxy (`docs.royaleapi.com/proxy.html`)
on transport failure, HTTP 5xx, or HTTP 403 (key/IP mismatch on one host
often succeeds on the other). HTTP 429 never fails over — it propagates as
`rate_limited` so quota is not burned twice. Customer-facing sources are
`eidren_brawl_stars`, `eidren_clash_of_clans`, `eidren_clash_royale`.

New in Phase 1: full profile summaries at
`/api/lookup/{game}/profile` (identity, trophies, level, wins, club pointer,
game-specific counts; 5-minute TTL with single-flight coalescing) and a
no-secret operator health endpoint at `/api/lookup/supercell-health`
(per-game key presence + resolved primary/secondary hosts, no network I/O).

Configure the per-game server-only Railway variables:

- `BRAWL_STARS_API_KEY` from developer.brawlstars.com
- `CLASH_OF_CLANS_API_KEY` from developer.clashofclans.com
- `CLASH_ROYALE_API_KEY` from developer.clashroyale.com

When creating each key, allowlist BOTH the Railway backend egress IP
(primary: official host) and RoyaleAPI's proxy IP `45.79.218.79`
(secondary). Eidren sends each key as a bearer token to the active host.
These lookups do not use Fixie. Optional `*_API_BASE` variables override
the primary base and `*_API_FALLBACK_BASE` variables override the
secondary; keep overrides server-side and compatible with the key's IP
allowlist. A missing game key logs `missing_config` server-side and
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
