# Production monitoring

Railway service: `nexus-mlbb-ign-lookup` (API-only, region `iad`).

## Health endpoint

`GET /api/health` — no auth, no DB writes, no secrets in the response.

```json
{ "success": true, "status": "ok", "service": "nexus-mlbb-ign-lookup",
  "commit": "abc1234", "database": "up", "responseMs": 120 }
```

- `status: "ok"` — app serves and Supabase REST answers.
- `status: "degraded"` — still HTTP 200 so Railway keeps serving; alert on
  the field, not the code.
- `commit` comes from `RAILWAY_GIT_COMMIT_SHA`; `unknown` locally.

Railway reads `railway.json` at deploy time: `/api/health` is the
healthcheck path (60s timeout) with restart-on-failure (max 5 retries).
After changing that file, any redeploy picks it up.

## Scheduled regression

Workflow `.github/workflows/prod-regression.yml` runs
`scripts/prod-regression.mjs` weekly (Mondays) plus on manual dispatch.
It exercises every live-verified mode with pinned samples:

CODM nickname / shortId / bogus-404 / numeric-degraded, FF weapons +
sensitivity, PUBG Lite-vs-Global routing + Global anchor, MLBB anchor,
health. Read-only lookups only; failures print route + expected vs
actual status/code, never the key or nicknames.

Cadence note: the sweep makes 9 metered calls per run and the monitor
key lives on the free plan (100 calls/month/key). Weekly ≈ 36/month
leaves room for manual re-runs. Raise the cadence only after moving
the monitor key under a pro account.

Required repository secrets:

| Secret | Value |
|---|---|
| `PROD_BASE_URL` | `https://nexus-mlbb-ign-lookup-production.up.railway.app` |
| `EIDREN_MONITOR_KEY` | dedicated `eid_…` key named `monitor-production-regression` |
| `DISCORD_WEBHOOK_URL` | incoming webhook for failure pings (optional but expected) |

## Monitor key rotation

1. Generate a value (`eid_` + 32 base64url bytes) and its SHA-256 hex hash
   (see `newApiKey`/`hashApiKey` in `src/lib/platform.ts`), then mint:
   `SELECT * FROM create_developer_api_key('<owner-uuid>', '<owner-uuid>',
   NULL, 'monitor-production-regression', '<hash>', '<prefix>', 'free');`
2. Update the `EIDREN_MONITOR_KEY` repository secret.
3. Trigger the workflow manually and confirm 12/12 green.
4. Revoke the old key: `UPDATE api_keys SET revoked_at = now()
   WHERE key_prefix = '<old-prefix>';`
5. Confirm the old key returns 401.

Rotate at least every 90 days, and immediately after any suspected leak.

## Discord deploy alerts

Railway project → service → Settings → Webhooks: register the same
incoming webhook for deploy failure, crash, and OOM events. Test with
the workflow's failure ping or a deliberately failing manual dispatch
before relying on it.
