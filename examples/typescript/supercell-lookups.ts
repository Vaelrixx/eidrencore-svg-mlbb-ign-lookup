/**
 * Runnable examples for the three Supercell endpoints.
 *
 *   EIDREN_API_KEY=eid_... npx tsx examples/typescript/supercell-lookups.ts
 *
 * (Or compile with tsc and run the emitted JS with node.)
 */
import {
  createEidrenClient,
  EidrenApiError,
  type SupercellGame,
} from "./eidren-client";

const apiKey = process.env.EIDREN_API_KEY;
if (!apiKey) {
  console.error("Set EIDREN_API_KEY first (create one at /dashboard/keys).");
  process.exit(1);
}
const eidren = createEidrenClient(apiKey);

// 1. One-liners per game.
async function basic() {
  const bs = await eidren.lookupBrawlStars("#2PP");
  console.log(`Brawl Stars ${bs.tag} -> ${bs.nickname}`);

  const coc = await eidren.lookupClashOfClans("#2PP");
  console.log(`Clash of Clans ${coc.tag} -> ${coc.nickname}`);

  const cr = await eidren.lookupClashRoyale("#C0G20PR2");
  console.log(`Clash Royale ${cr.tag} -> ${cr.nickname}`);
}

// 2. Game picker: one code path for all three games.
const GAMES: SupercellGame[] = ["brawl-stars", "clash-of-clans", "clash-royale"];

async function withGamePicker(game: SupercellGame, tag: string) {
  const result = await eidren.lookupSupercell(game, tag);
  console.log(`[${game}] ${result.tag} -> ${result.nickname}`);
}

// 3. Honest error handling: not-found is a different branch from outages.
async function withErrorHandling(game: SupercellGame, tag: string) {
  try {
    const result = await eidren.lookupSupercell(game, tag);
    console.log(`Found: ${result.nickname}`);
  } catch (error) {
    if (!(error instanceof EidrenApiError)) throw error;
    switch (error.code) {
      case "INVALID_TAG":
        console.error("That tag is malformed — ask the user to check it.");
        break;
      case "BS_PLAYER_NOT_FOUND":
      case "COC_PLAYER_NOT_FOUND":
      case "CR_PLAYER_NOT_FOUND":
        console.error("Confirmed: no account exists for that tag.");
        break;
      case "API_QUOTA_EXCEEDED":
        console.error("Monthly quota reached — upgrade the plan.");
        break;
      default:
        if (error.retryable) {
          console.error(
            `Temporary failure (${error.code}); retry${error.retryAfterSeconds ? ` after ${error.retryAfterSeconds}s` : " shortly"}. Request: ${error.requestId ?? "n/a"}.`,
          );
        } else {
          console.error(`Lookup failed: ${error.code} — ${error.message}`);
        }
    }
  }
}

// 4. Bounded retry for transient failures (rate limits / upstream outages).
async function withRetry(
  game: SupercellGame,
  tag: string,
  maxAttempts = 3,
) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await eidren.lookupSupercell(game, tag);
    } catch (error) {
      const retryable = error instanceof EidrenApiError && error.retryable;
      if (!retryable || attempt >= maxAttempts) throw error;
      const backoffMs =
        error instanceof EidrenApiError && error.retryAfterSeconds
          ? error.retryAfterSeconds * 1000
          : 1000 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

async function main() {
  await basic();
  for (const game of GAMES) {
    await withGamePicker(game, game === "clash-royale" ? "#C0G20PR2" : "#2PP");
  }
  await withErrorHandling("brawl-stars", "#QQQQQQQQ"); // unknown tag
  const retried = await withRetry("clash-royale", "#C0G20PR2");
  console.log(`Retried lookup -> ${retried.nickname}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
