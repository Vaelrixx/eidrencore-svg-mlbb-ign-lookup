# Eidren TypeScript examples

Typed integration examples for the Eidren player-lookup API. Server-side only — never ship your API key in browser code.

| File | What it is |
| --- | --- |
| `eidren-client.ts` | Minimal typed client for all four games (MLBB + three Supercell games). No dependencies, Node 18+. |
| `supercell-lookups.ts` | Runnable examples: one-liners, a game picker, honest error handling, bounded retry. |
| `nextjs-route-example.ts` | Copy-paste Next.js App Router route that proxies lookups so the key stays server-side. |

## Run the examples

```bash
EIDREN_API_KEY=eid_... npx tsx examples/typescript/supercell-lookups.ts
```

Or compile and run with plain node:

```bash
npx tsc examples/typescript/supercell-lookups.ts --outDir /tmp/eidren-examples --module nodenext --target es2022 --skipLibCheck
EIDREN_API_KEY=eid_... node /tmp/eidren-examples/supercell-lookups.js
```

## Endpoints

- `POST /api/lookup` — Mobile Legends, body `{ "playerId": "123456789", "zoneId": "1234" }`
- `POST /api/lookup/brawl-stars` — body `{ "tag": "#2PP" }`
- `POST /api/lookup/clash-of-clans` — body `{ "tag": "#2PP" }`
- `POST /api/lookup/clash-royale` — body `{ "tag": "#C0G20PR2" }`

All endpoints take `Authorization: Bearer eid_...` and return `{ "success": true, "data": { "nickname", ... } }` or `{ "success": false, "error", "code" }` with an `X-Lookup-Request-Id` header. Tags use Supercell's `0289PYLQGRJCUV` alphabet and are case-insensitive.

## Error codes

| Code | Meaning |
| --- | --- |
| `INVALID_TAG` | Malformed Supercell tag (400) |
| `BS_PLAYER_NOT_FOUND` / `COC_PLAYER_NOT_FOUND` / `CR_PLAYER_NOT_FOUND` | Confirmed: no account for that tag (404) |
| `PLAYER_NOT_FOUND` | Confirmed: no MLBB account for that ID (404) |
| `API_QUOTA_EXCEEDED` | Monthly quota reached (429) |
| `UPSTREAM_RATE_LIMIT` / `UPSTREAM_UNAVAILABLE` | Temporary provider failure — retry (429/502) |
| `GAME_NOT_CONFIGURED` | Game key not set server-side (503) |
