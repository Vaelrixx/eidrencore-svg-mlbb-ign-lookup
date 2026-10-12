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

Contract notes:

- RapidAPI uses the documented `mobile-legends` slug. Only the structured
  `id_not_found` body counts as not-found; `no_content_0` is unavailable.
- WhoPlays: only `error: "not_found"` (HTTP 422) counts as not-found.
  `unauthorized` / `parse` / `upstream` degrade to unavailable so a bad key
  never poisons the all-not-found verdict.
- Missing keyed-provider keys degrade to `missing_config` without fetching.
- Customer-facing source is always `eidren_mlbb` regardless of adapter.

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

- `npm run test:provider-adapters` — RapidAPI + WhoPlays classification.
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
