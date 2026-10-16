# Identity Lookup APIs

Resolve a player's in-game name from an account identifier. All routes require an Eidren API key or a signed-in playground session. API-key calls use `Authorization: Bearer eid_...` and JSON `POST` bodies.

## Supported routes

| Game | Route | Request body | Public source label |
| --- | --- | --- | --- |
| PUBG Mobile Global | `POST /api/lookup/pubg-mobile` | `{ "playerId": "5204837417" }` | `eidren_pubg_mobile` |
| Call of Duty: Mobile (Garena) | `POST /api/lookup/call-of-duty-mobile` | `{ "playerId": "8370310025568788000" }` | `eidren_call_of_duty_mobile` |
| VALORANT | `POST /api/lookup/valorant` | `{ "name": "ucup", "tag": "123" }` | `eidren_valorant` |
| Genshin Impact | `POST /api/lookup/genshin-impact` | `{ "playerId": "844335555", "server": "asia" }` | `eidren_genshin_impact` |
| Honkai: Star Rail | `POST /api/lookup/honkai-star-rail` | `{ "playerId": "800333000" }` | `eidren_honkai_star_rail` |
| Zenless Zone Zero | `POST /api/lookup/zenless-zone-zero` | `{ "playerId": "1317572318" }` | `eidren_zenless_zone_zero` |
| Honor of Kings | `POST /api/lookup/honor-of-kings` | `{ "playerId": "17960996468644334037" }` | `eidren_honor_of_kings` |
| Free Fire | `POST /api/lookup/free-fire` | `{ "playerId": "1958604115" }` | `eidren_free_fire` |
| Free Fire Global | `POST /api/lookup/free-fire-global` | `{ "playerId": "12341234" }` | `eidren_free_fire_global` |

Genshin `server` is required and must be one of `asia`, `america`, `europa`, or `china`. Genshin lookups run through a two-source identity chain behind the single `eidren_genshin_impact` source label, so UIDs missing from one feed still resolve when the other carries them. The Call of Duty route covers the Garena region. PUBG Mobile is the Global route.

Honkai: Star Rail and Zenless Zone Zero accept numeric UIDs as strings and use their game-specific profile lookup paths. Their endpoints do not require a server field. Responses accept only the observed nickname field for the requested game; an upstream response counts as not-found only on explicit HTTP 404. Other unfamiliar or failed responses return the standard service-unavailable envelope.

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
PUBG Lite's keyless secondary covers the shared PUBG-family pool but stays behind the keyed primary, so Lite-pool-only IDs resolve through the primary while pool misses on the secondary degrade honestly instead of reporting not-found.
