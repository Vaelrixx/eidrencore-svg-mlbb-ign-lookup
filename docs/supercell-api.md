# Supercell lookup API reference

Eidren exposes authenticated lookup endpoints per game — player identity,
clan/club identity, battle history, and location rankings:

| Game | Player | Clan / club | Battles / wars | Rankings |
| --- | --- | --- | --- | --- |
| Brawl Stars | `POST /api/lookup/brawl-stars` | `POST /api/lookup/brawl-stars/club` | `POST /api/lookup/brawl-stars/battles` | `POST /api/lookup/brawl-stars/rankings` |
| Clash of Clans | `POST /api/lookup/clash-of-clans` | `POST /api/lookup/clash-of-clans/clan` | `POST /api/lookup/clash-of-clans/warlog` | `POST /api/lookup/clash-of-clans/rankings` |
| Clash Royale | `POST /api/lookup/clash-royale` | `POST /api/lookup/clash-royale/clan` | `POST /api/lookup/clash-royale/battles` | `POST /api/lookup/clash-royale/rankings` |

Example tags: `#2PP` (Brawl Stars and Clash of Clans players), `#C0G20PR2`
(Clash Royale player). Clan tags follow the same format.

Player endpoints resolve a Supercell player tag to the player's in-game
nickname. Clan/club endpoints resolve a group tag to the group's name and
roster summary. Battle endpoints return up to 25 recent battles (or clan
wars for Clash of Clans). Rankings endpoints return up to 25 leaderboard
entries for a location. All endpoints use the same Eidren authentication,
plan quota, and IP rate limits as the MLBB lookup API. Eidren is an
independent identity network and is not affiliated with Supercell or any
game publisher.

## Authentication

Send an Eidren API key as a bearer token. Create and manage keys in **Dashboard → API keys**. Keep keys in server-side secrets; do not put them in browser JavaScript, public repositories, or mobile-app bundles.

```
Authorization: Bearer eid_YOUR_API_KEY
Content-Type: application/json
```

A signed-in dashboard session can also authenticate requests made by the playground. For server-to-server integrations, use an API key.

## Request

Use `POST` with a JSON object containing one required property:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tag` | string | Yes | Supercell player tag, with or without a leading `#`. |

The service trims whitespace, removes a leading `#`, and normalizes the tag to uppercase before lookup. The tag must use Supercell's `0289PYLQGRJCUV` alphabet and contain 3–20 characters after the optional `#`. Tag syntax is shared, but an account tag is game-specific: a tag that resolves in Brawl Stars or Clash of Clans may not identify a Clash Royale account.

### Brawl Stars

```bash
curl -X POST 'https://nexus-mlbb-ign-lookup-production.up.railway.app/api/lookup/brawl-stars' \
  -H 'Authorization: Bearer eid_YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"tag":"#2PP"}'
```

### Clash of Clans

```bash
curl -X POST 'https://nexus-mlbb-ign-lookup-production.up.railway.app/api/lookup/clash-of-clans' \
  -H 'Authorization: Bearer eid_YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"tag":"#2PP"}'
```

### Clash Royale

```bash
curl -X POST 'https://nexus-mlbb-ign-lookup-production.up.railway.app/api/lookup/clash-royale' \
  -H 'Authorization: Bearer eid_YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"tag":"#C0G20PR2"}'
```

`#C0G20PR2` is the verified Clash Royale sample. `#2PP` is a valid example for Brawl Stars and Clash of Clans, but it does not resolve in Clash Royale. A well-formed tag is not necessarily an existing player tag for the selected game.

## Success response

A successful lookup returns HTTP `200` and a normalized response envelope. The `source` value identifies the Eidren game network that served the lookup.

```json
{
  "success": true,
  "data": {
    "nickname": "ExamplePlayer",
    "tag": "#C0G20PR2",
    "source": "eidren_clash_royale"
  }
}
```

The source labels are `eidren_brawl_stars`, `eidren_clash_of_clans`, and `eidren_clash_royale`. Treat `nickname` and `tag` as strings. Do not assume a successful nickname is globally unique.

## Clan, battle, and rankings responses

Clan/club endpoints accept `{ "tag": "#..." }` and return the group's name
plus a roster summary:

```json
{
  "success": true,
  "data": {
    "name": "Example Clan",
    "tag": "#2PP",
    "group": "clan",
    "details": { "name": "Example Clan", "memberCount": 30 },
    "source": "clash_royale_official_api"
  }
}
```

Battle endpoints accept `{ "tag": "#..." }` and return up to 25 recent
battles (Clash of Clans returns clan `wars` for a clan tag instead):

```json
{
  "success": true,
  "data": {
    "tag": "#C0G20PR2",
    "battles": [{ "type": "PvP", "teamCrowns": 3, "opponentCrowns": 1 }],
    "count": 1,
    "source": "clash_royale_official_api"
  }
}
```

Rankings endpoints accept `{ "locationId": "global" }` (`locationId` defaults
to `"global"` when omitted) and return up to 25 leaderboard entries:

```json
{
  "success": true,
  "data": {
    "locationId": "global",
    "entries": [{ "rank": 1, "name": "Top", "tag": "#AAA" }],
    "count": 1,
    "source": "clash_royale_official_api"
  }
}
```

## Errors

Errors use a JSON envelope of the form:

```json
{
  "success": false,
  "error": "A human-readable explanation",
  "code": "INVALID_TAG"
}
```

The `X-Lookup-Request-Id` response header is provided for request correlation. A `Retry-After` header may be included for rate-limited responses.

| HTTP status | Code | Meaning | Suggested handling |
| --- | --- | --- | --- |
| `400` | `INVALID_JSON` | The request body is not valid JSON. | Correct the JSON and retry. |
| `400` | `INVALID_INPUT` | The JSON body is not an object. | Send a JSON object with a string `tag`. |
| `400` | `INVALID_TAG` | The `tag` is missing, not a string, or does not match the accepted format/alphabet. | Send a valid tag string and check for unsupported characters. |
| `400` | `INVALID_LOCATION` | The `locationId` is not `global` or a numeric location ID. | Send `global` or a documented location ID. |
| `401` | `AUTH_REQUIRED` | No valid API key or signed-in session was supplied. | Add a valid bearer token. |
| `401` | `INVALID_API_KEY` | The API key is invalid or revoked. | Create a replacement key and revoke the exposed/old key. |
| `404` | `BS_PLAYER_NOT_FOUND`, `COC_PLAYER_NOT_FOUND`, or `CR_PLAYER_NOT_FOUND` | Eidren confirmed that no account exists for that player tag. | Confirm the game and tag; don't reuse another game's example blindly. |
| `404` | `BS_CLUB_NOT_FOUND`, `COC_CLAN_NOT_FOUND`, or `CR_CLAN_NOT_FOUND` | Eidren confirmed that no clan/club exists for that tag. | Confirm the game and tag. |
| `404` | `RANKINGS_NOT_FOUND` | Eidren found no rankings for that location. | Confirm the location ID. |
| `429` | `API_QUOTA_EXCEEDED` | The account's monthly API quota is exhausted. | Check the dashboard usage page or plan. |
| `429` | `PLAYGROUND_LIMIT` | The signed-in playground allowance is exhausted. | Wait for its reset or use an API key within plan quota. |
| `429` | `RATE_LIMITED` | The shared per-client request rate limit was reached. | Honor `Retry-After` and retry with backoff. |
| `429` | `SERVICE_RATE_LIMIT` | Eidren is rate-limiting requests right now. | Honor `Retry-After`; use bounded backoff. |
| `503` | `QUOTA_UNAVAILABLE` | The quota service could not authorize a lookup. | Retry later; do not interpret as not found. |
| `502` | `SERVICE_UNAVAILABLE` | Eidren could not verify the tag right now. | Retry later with bounded backoff; do not interpret as not found. |

Game-specific not-found codes are `BS_PLAYER_NOT_FOUND` (Brawl Stars), `COC_PLAYER_NOT_FOUND` (Clash of Clans), and `CR_PLAYER_NOT_FOUND` (Clash Royale). Temporary outages are never reported as evidence that a player does not exist.

## GET discovery and compatibility

Each endpoint also supports `GET` for service discovery. Calling the route without a tag returns endpoint information and an example. A `GET` request with a `tag` query parameter performs the same authenticated lookup as `POST`; `POST` is recommended for integrations so tags are not placed in URLs, browser history, or intermediary logs.

```
GET /api/lookup/clash-royale?tag=%23C0G20PR2
Authorization: Bearer eid_YOUR_API_KEY
```

## Testing

Run `npm run test:supercell` to test tag normalization, response classification, and per-game routing. The test suite does not make production lookups.
