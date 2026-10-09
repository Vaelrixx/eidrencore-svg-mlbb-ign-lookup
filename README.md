# NEXUS — MLBB IGN Lookup

Standalone Next.js + TypeScript UI and API for resolving Mobile Legends: Bang Bang nicknames from Player ID + Zone ID.

The app owns the UI, input validation, API route, response handling, and deployment. It does not use RapidAPI or a paid lookup API vendor. For real account data, the server currently relies on Codashop's account-validation flow, which is an external upstream dependency—not an official Moonton API. Live lookup is not yet verified. Do not treat errors/timeouts as proof that an account is invalid.

## Run

Requires Node.js 20.9+.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## API

`POST /api/lookup`

```json
{ "playerId": "123456789", "zoneId": "1234" }
```

A successful response only returns a nickname when the upstream explicitly confirms success and includes a username. Otherwise the route returns an error code; it never fabricates a result.

## Before production

- Verify Codashop acceptable-use terms and test known-valid/invalid IDs at low volume.
- Add distributed rate limiting before public launch.
- Monitor upstream failures.

Not affiliated with or endorsed by MOONTON Games or Codashop.
