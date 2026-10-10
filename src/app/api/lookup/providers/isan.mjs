import { confirmedNickname } from "../nickname-validation.mjs";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

/**
 * Public community nickname endpoint, as an independent fallback host/path.
 * Shared by the production route and the live fallback smoke test.
 */
export async function lookupIsan(playerId, zoneId) {
  const query = new URLSearchParams({ id: playerId, server: zoneId, decode: "false" });
  try {
    const upstream = await fetch(`https://api.isan.eu.org/nickname/ml?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "EidrenMLBBLookup/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (upstream.status === 429) return { kind: "rate_limited" };
    if (upstream.status === 404 || upstream.status === 400) return { kind: "unavailable" };
    if (!upstream.ok) return { kind: "unavailable" };

    const payload = await upstream.json().catch(() => null);
    const data = record(payload);
    const nickname = confirmedNickname(payload);
    if (data?.success === true && nickname) {
      return { kind: "success", nickname, source: "isan_nickname_api" };
    }

    const root = record(payload);
    const nested = record(root?.data);
    const message = [
      root?.message, root?.msg, root?.error, root?.reason,
      nested?.message, nested?.msg, nested?.error, nested?.reason,
    ].filter((value) => typeof value === "string").join(" ");
    if (
      (root?.success === false || root?.valid === false || nested?.valid === false) &&
      /not found|does not exist|invalid|cannot find|can't find|no such|wrong (player|user|game)?\s*id/i.test(message)
    ) {
      return { kind: "not_found" };
    }
    if (/not found|does not exist|invalid (player|user|game)?\s*id|cannot find|can't find|no such account/i.test(message)) {
      return { kind: "not_found" };
    }
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
