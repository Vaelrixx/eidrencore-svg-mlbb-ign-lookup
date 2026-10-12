# Identity Lookup APIs

Resolve a player's in-game name from an account identifier. All routes require an Eidren API key or a signed-in playground session. API-key calls use `Authorization: Bearer eid_...` and JSON `POST` bodies.

## Supported routes

| Game | Route | Request body | Public source label |
| --- | --- | --- | --- |
| PUBG Mobile Global | `POST /api/lookup/pubg-mobile` | `{ "playerId": "5204837417" }` | `eidren_pubg_mobile` |
| Call of Duty: Mobile (Garena) | `POST /api/lookup/call-of-duty-mobile` | `{ "playerId": "8370310025568788000" }` | `eidren_call_of_duty_mobile` |
| VALORANT | `POST /api/lookup/valorant` | `{ "name": "ucup", "tag": "123" }` | `eidren_valorant` |
| Genshin Impact | `POST /api/lookup/genshin-impact` | `{ "playerId": "844335555", "server": "asia" }` | `eidren_genshin_impact` |
| Honor of Kings | `POST /api/lookup/honor-of-kings` | `{ "playerId": "17960996468644334037" }` | `eidren_honor_of_kings` |
| Free Fire | `POST /api/lookup/free-fire` | `{ "playerId": "1958604115" }` | `eidren_free_fire` |
| Free Fire Global | `POST /api/lookup/free-fire-global` | `{ "playerId": "12341234" }` | `eidren_free_fire_global` |

Genshin `server` is required and must be one of `asia`, `america`, `europa`, or `china`. Genshin lookups run through a two-source identity chain behind the single `eidren_genshin_impact` source label, so UIDs missing from one feed still resolve when the other carries them. The Call of Duty route covers the Garena region. PUBG Mobile is the Global route.

Free Fire routes are key-ready: the endpoints validate input and return honest degraded responses until a provider key or fallback is provisioned. Request samples use the provider's documented examples. The routes share the standard response envelope, so no client changes are needed when the upstream is connected.

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

Genshin responses also echo the selected `server` value. A missing identity returns HTTP `404` with a game-specific `*_PLAYER_NOT_FOUND` code. Invalid data returns `400 INVALID_INPUT`; authentication failures return `401`; quota limits return `429`; and upstream outages return `502 SERVICE_UNAVAILABLE`. Temporary service throttling returns `429 SERVICE_RATE_LIMIT`. Error responses include an `X-Lookup-Request-Id` header.

A sample account may stop resolving as game data changes. The service reports an account as missing only when it receives an explicit missing-account result; degraded or unfamiliar upstream responses are treated as unavailable instead, so a provider-side outage never becomes a false missing-account verdict.
