# Identity Lookup APIs

Resolve a player's in-game name from an account identifier. All routes require an Eidren API key or a signed-in playground session. API-key calls use `Authorization: Bearer eid_...` and JSON `POST` bodies.

## Supported routes

| Game | Route | Request body | Public source label |
| --- | --- | --- | --- |
| PUBG Mobile Global | `POST /api/lookup/pubg-mobile` | `{ "playerId": "5204837417" }` | `eidren_pubg_mobile` |
| Call of Duty: Mobile (Garena) | `POST /api/lookup/call-of-duty-mobile` | `{ "playerId": "ShadowHex" }` (numeric ID or nickname) | `eidren_call_of_duty_mobile` |
| VALORANT | `POST /api/lookup/valorant` | `{ "name": "ucup", "tag": "123" }` | `eidren_valorant` |
| Genshin Impact | `POST /api/lookup/genshin-impact` | `{ "playerId": "844335555", "server": "asia" }` | `eidren_genshin_impact` |
| Honkai: Star Rail | `POST /api/lookup/honkai-star-rail` | `{ "playerId": "800333000" }` | `eidren_honkai_star_rail` |
| Zenless Zone Zero | `POST /api/lookup/zenless-zone-zero` | `{ "playerId": "1317572318" }` | `eidren_zenless_zone_zero` |
| Honor of Kings | `POST /api/lookup/honor-of-kings` | `{ "playerId": "17960996468644334037" }` | `eidren_honor_of_kings` |
| Free Fire | `POST /api/lookup/free-fire` | `{ "playerId": "1958604115" }` | `eidren_free_fire` |
| Free Fire Global | `POST /api/lookup/free-fire-global` | `{ "playerId": "12341234" }` | `eidren_free_fire_global` |

Genshin `server` is required and must be one of `asia`, `america`, `europa`, or `china`. Genshin lookups run through a two-source identity chain behind the single `eidren_genshin_impact` source label, so UIDs missing from one feed still resolve when the other carries them. The Call of Duty route covers the Garena region. PUBG Mobile is the Global route.

### Call of Duty nickname vs numeric input

The Call of Duty route accepts a numeric Player ID, a nickname, or a shortId in the same `playerId` field. All-digit inputs stay on the keyed route; nicknames and shortIds go direct to the Coda white-label voucher (keyless, zero third-party runtime), which follows one country redirect to the account's home store when needed. Bogus nicknames return `404 CODM_PLAYER_NOT_FOUND` on the explicit No-openId envelope. Live-verified 2026-10-17: `ShadowHex` resolves via its BG home store; shortId `6QKPNM` resolves back to `ShadowHex`; `ZzZzNoSuchPlayer9x8y7z` 404s. All-digit input always routes keyed, even if a numeric-named account exists.

Honkai: Star Rail and Zenless Zone Zero accept numeric UIDs as strings and use their game-specific profile lookup paths. Zenless Zone Zero stays UID-only: Enka is the primary, and only when Enka is degraded does a keyless secondary sweep all four store servers in parallel — first success wins, and not-found requires a unanimous miss across every server, so a UID living on another server never false-404s. Their endpoints do not require a server field. Responses accept only the observed nickname field for the requested game; an upstream response counts as not-found only on explicit HTTP 404. Other unfamiliar or failed responses return the standard service-unavailable envelope.

Free Fire, PUBG Mobile, and FC Mobile run direct keyless legs behind their single source labels (no keyed hop, zero third-party runtime). Bigo Live, Higgs Domino, and Teen Patti Gold run primary-only on the keyed route (no keyless fallback found). Jawaker runs a two-source chain behind its single source label (keyed primary, then the official webshop player check). Arena of Valor and PUBG Mobile Lite each run a two-source chain behind their single source label: the keyed route first, then a keyless secondary when the primary is degraded.

### PUBG Lite vs Global routing

The Global route (`/api/lookup/pubg-mobile`) only resolves Global-pool IDs, and the Lite route (`/api/lookup/pubg-lite`) resolves Lite-pool IDs through its keyed primary. A Lite-pool ID sent to the Global route returns `404 PUBG_PLAYER_NOT_FOUND` — the verdict is scoped to the route's pool ("No PUBG Mobile Global account was found"), not a claim the ID exists nowhere. Live-verified 2026-10-17: `7228395004` 404s on the Global route and resolves to `silviamegaf` on the Lite route. Send each ID to its own route.

### IDs are strings

Send every numeric-looking player ID as a JSON string. The API rejects numeric JSON values rather than risk accepting a rounded value. In JavaScript and TypeScript, do not pass these IDs through `Number`, `parseInt`, or arithmetic. Honor of Kings IDs are 20 digits and exceed JavaScript's safe integer range.

## JavaScript example

```js
const baseUrl = process.env.EIDREN_BASE_URL;
const apiKey = process.env.EIDREN_API_KEY;
const playerId = "17960996468644334037"; // Keep it a string.

const response = await fetch(`${baseUrl}/api/lookup/honor-of-kings`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ playerId }),
});

const result = await response.json();
if (!response.ok || !result.success) {
  throw new Error(`${result.code}: ${result.error}`);
}
console.log(result.data.nickname);
```

Genshin requires the server explicitly:

```js
const response = await fetch(`${baseUrl}/api/lookup/genshin-impact`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ playerId: "844335555", server: "asia" }),
});
```

## TypeScript client example

```ts
import { createEidrenClient } from "./eidren-client";

const eidren = createEidrenClient(process.env.EIDREN_API_KEY!);
const pubg = await eidren.lookupPubgMobile("5204837417");
const genshin = await eidren.lookupGenshinImpact("844335555", "asia");
const honorOfKings = await eidren.lookupHonorOfKings("17960996468644334037");

console.log(pubg.nickname, genshin.nickname, honorOfKings.nickname);
```

`lookupGenshinImpact` requires a `GenshinServer` argument. All ID parameters in the client are typed as `string`, including Honor of Kings. Keep the client and API key on a trusted server; never bundle the key into browser code.

## Normalized response

A successful lookup returns the resolved name and echoes the submitted fields as strings:

```json
{
  "success": true,
  "data": {
    "nickname": "ExamplePlayer",
    "playerId": "17960996468644334037",
    "source": "eidren_honor_of_kings"
  }
}
```

Genshin responses also echo the selected `server` value. A missing identity returns HTTP `404` with a game-specific `*_PLAYER_NOT_FOUND` code. Invalid data returns `400 INVALID_INPUT`; request bodies larger than 4 KiB return `413 PAYLOAD_TOO_LARGE`; authentication failures return `401`; quota limits return `429`; and upstream outages return `502 SERVICE_UNAVAILABLE`. Temporary service throttling returns `429 SERVICE_RATE_LIMIT`. Error responses include an `X-Lookup-Request-Id` header.

A sample account may stop resolving as game data changes. The service reports an account as missing only when it receives an explicit missing-account result; degraded or unfamiliar upstream responses are treated as unavailable instead, so a provider-side outage never becomes a false missing-account verdict. The direct legs gate not-found on code-specific explicit envelopes (PUBG Global misses say "Invalid user account"; Free Fire and Arena of Valor misses say "Unknown User"); anything else degrades to `502`.
| Arena of Valor | `POST /api/lookup/arena-of-valor` | `{ "playerId": "195293573153949" }` | `eidren_arena_of_valor` |
| PUBG Mobile Lite | `POST /api/lookup/pubg-lite` | `{ "playerId": "7228395004" }` | `eidren_pubg_lite` |
| Teen Patti Gold | `POST /api/lookup/teen-patti-gold` | `{ "playerId": "100439992784" }` | `eidren_teen_patti_gold` |
| Jawaker | `POST /api/lookup/jawaker` | `{ "playerId": "1473084005" }` | `eidren_jawaker` |
| FC Mobile | `POST /api/lookup/fc-mobile` | `{ "playerId": "1856150661662899105" }` | `eidren_fc_mobile` |
| Bigo Live | `POST /api/lookup/bigo-live` | `{ "playerId": "901234567" }` | `eidren_bigo_live` |
| Higgs Domino | `POST /api/lookup/higgs-domino` | `{ "playerId": "55666" }` | `eidren_higgs_domino` |
| 8 Ball Pool | `POST /api/lookup/8-ball-pool` | `{ "playerId": "12345" }` | `eidren_8_ball_pool` |
| Arena Breakout | `POST /api/lookup/arena-breakout` | `{ "playerId": "123456789" }` | `eidren_arena_breakout` |
| Blood Strike | `POST /api/lookup/blood-strike` | `{ "playerId": "123456789" }` | `eidren_blood_strike` |
| Delta Force (Garena) | `POST /api/lookup/delta-force-garena` | `{ "playerId": "123456789" }` | `eidren_delta_force_garena` |
| Eggy Party | `POST /api/lookup/eggy-party` | `{ "playerId": "123456789", "server": "asia" }` | `eidren_eggy_party` |
| Ace Racer | `POST /api/lookup/ace-racer` | `{ "playerId": "123456789", "server": "asia" }` | `eidren_ace_racer` |
| Dragon Raja | `POST /api/lookup/dragon-raja` | `{ "playerId": "123456789" }` | `eidren_dragon_raja` |
| Metal Slug | `POST /api/lookup/metal-slug` | `{ "playerId": "123456789" }` | `eidren_metal_slug` |
| LifeAfter | `POST /api/lookup/lifeafter` | `{ "playerId": "11043723", "server": "NancyCity" }` | `eidren_lifeafter` |
| One Punch Man: The Strongest | `POST /api/lookup/one-punch-man` | `{ "playerId": "123456789", "server": "1" }` | `eidren_one_punch_man` |
| Pokémon UNITE | `POST /api/lookup/pokemon-unite` | `{ "playerId": "LYK85AP" }` | `eidren_pokemon_unite` |
| Whiteout Survival | `POST /api/lookup/whiteout-survival` | `{ "playerId": "123456789" }` | `eidren_whiteout_survival` |
| Hay Day | `POST /api/lookup/hay-day` | `{ "playerId": "PURC098R2" }` | `eidren_hay_day` |
| Magic Chess: Go Go | `POST /api/lookup/magic-chess` | `{ "playerId": "12345678", "server": "1234" }` | `eidren_magic_chess` |
| Speed Drifters | `POST /api/lookup/speed-drifters` | `{ "playerId": "123456789" }` | `eidren_speed_drifters` |
| Super Sus | `POST /api/lookup/super-sus` | `{ "playerId": "163588582" }` | `eidren_super_sus` |
| Point Blank | `POST /api/lookup/point-blank` | `{ "playerId": "123456789" }` | `eidren_point_blank` |
PUBG Lite's keyless secondary covers the shared PUBG-family pool but stays behind the keyed primary, so Lite-pool-only IDs resolve through the primary while pool misses on the secondary degrade honestly instead of reporting not-found.

## Bulk verification

`POST /api/lookup/bulk` verifies up to 100 identities in one call across all 37 games. Each item names a game slug plus that game's lookup fields, and each item consumes one monthly quota unit (a 50-item batch needs 50 remaining units or the whole call is rejected with `429 API_QUOTA_EXCEEDED` before any lookup runs). Request bodies are capped at 128 KiB. Items resolve in pools of 10 so one slow upstream cannot stall the batch.

```json
{
  "items": [
    { "game": "mlbb", "playerId": "1114917746", "zoneId": "13486", "nickname": "optional claimed name" },
    { "game": "free-fire", "playerId": "1958604115" },
    { "game": "brawl-stars", "tag": "#2PP" }
  ]
}
```

Every item returns its own verdict; one bad item never fails the batch. `verified` items include the resolved nickname, the normalized input, the source label, and `nicknameMatch` (`true`/`false` when you supply a claimed `nickname`, `null` when you don't). Other per-item statuses are `not_found` (game-specific code, same as the single route), `invalid` (`INVALID_INPUT` or `UNKNOWN_GAME`), `unavailable` (`SERVICE_UNAVAILABLE`), and `rate_limited` (`SERVICE_RATE_LIMIT`). The response also carries a `summary` count block and a `requestId`.

Game slugs: `mlbb`, `pubg-mobile`, `call-of-duty-mobile`, `valorant`, `genshin-impact`, `honkai-star-rail`, `zenless-zone-zero`, `honor-of-kings`, `arena-of-valor`, `pubg-lite`, `teen-patti-gold`, `jawaker`, `fc-mobile`, `free-fire`, `free-fire-global`, `bigo-live`, `higgs-domino`, `brawl-stars`, `clash-of-clans`, `clash-royale`, `8-ball-pool`, `arena-breakout`, `blood-strike`, `delta-force-garena`, `eggy-party`, `ace-racer`, `dragon-raja`, `metal-slug`, `lifeafter`, `one-punch-man`, `pokemon-unite`, `whiteout-survival`, `hay-day`, `magic-chess`, `speed-drifters`, `super-sus`, `point-blank`. Field contracts match the single routes exactly. `GET /api/lookup/bulk` returns the live game list, limits, and an example without authentication.

Bulk completions emit a `lookup.bulk.completed` webhook event (subscribe in the console) with the request ID, summary counts, and quota units consumed. Per-game health over the last hour is public at `GET /api/lookup/status` (`operational`, `degraded`, or `unknown` when fewer than 3 checks ran).
