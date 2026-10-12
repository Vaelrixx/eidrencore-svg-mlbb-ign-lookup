/**
 * Minimal typed client for the Eidren player-lookup API.
 *
 * Covers all four live games: Mobile Legends plus Brawl Stars, Clash of
 * Clans, and Clash Royale. Server-side only — never ship your API key in
 * browser code.
 *
 * Requires Node 18+ (global fetch). No dependencies.
 */

export const EIDREN_BASE_URL =
  "https://nexus-mlbb-ign-lookup-production.up.railway.app";

export type SupercellGame = "brawl-stars" | "clash-of-clans" | "clash-royale";

export type MlbbLookupResult = {
  nickname: string;
  playerId: string;
  zoneId: string;
  country?: string;
  source: string;
};

export type SupercellLookupResult = {
  nickname: string;
  tag: string;
  source: string;
};

export type LookupErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_API_KEY"
  | "INVALID_INPUT"
  | "INVALID_ID"
  | "INVALID_TAG"
  | "INVALID_JSON"
  | "PLAYER_NOT_FOUND"
  | "BS_PLAYER_NOT_FOUND"
  | "COC_PLAYER_NOT_FOUND"
  | "CR_PLAYER_NOT_FOUND"
  | "RATE_LIMITED"
  | "PLAYGROUND_LIMIT"
  | "API_QUOTA_EXCEEDED"
  | "QUOTA_UNAVAILABLE"
  | "SERVICE_RATE_LIMIT"
  | "SERVICE_UNAVAILABLE";

export class EidrenApiError extends Error {
  readonly status: number;
  readonly code: LookupErrorCode | string;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(init: {
    status: number;
    code: LookupErrorCode | string;
    message: string;
    requestId?: string | null;
    retryAfterSeconds?: number | null;
  }) {
    super(init.message);
    this.name = "EidrenApiError";
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }

  /** True for 429/503/502-class failures that are worth retrying. */
  get retryable(): boolean {
    if (this.code === "API_QUOTA_EXCEEDED" || this.code === "PLAYGROUND_LIMIT") {
      return false;
    }
    return (
      this.status === 429 ||
      this.status === 502 ||
      this.status === 503 ||
      this.code === "SERVICE_RATE_LIMIT" ||
      this.code === "SERVICE_UNAVAILABLE"
    );
  }
}

type SuccessEnvelope<T> = { success: true; data: T };
type ErrorEnvelope = { success: false; error?: string; code?: string };

const GAME_ENDPOINTS: Record<SupercellGame, string> = {
  "brawl-stars": "/api/lookup/brawl-stars",
  "clash-of-clans": "/api/lookup/clash-of-clans",
  "clash-royale": "/api/lookup/clash-royale",
};

function retryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

async function post<T>(
  apiKey: string,
  path: string,
  body: Record<string, string>,
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const requestId = response.headers.get("x-lookup-request-id");
  const payload = (await response.json().catch(() => null)) as
    | SuccessEnvelope<T>
    | ErrorEnvelope
    | null;

  if (response.ok && payload?.success) {
    return (payload as SuccessEnvelope<T>).data;
  }
  const envelope = (payload ?? {}) as ErrorEnvelope;
  throw new EidrenApiError({
    status: response.status,
    code: envelope.code || "SERVICE_UNAVAILABLE",
    message: envelope.error || `Lookup failed with HTTP ${response.status}.`,
    requestId,
    retryAfterSeconds: retryAfterSeconds(response.headers),
  });
}

export type EidrenClientOptions = {
  baseUrl?: string;
  /** Override fetch for tests or custom runtimes. */
  fetchImpl?: typeof fetch;
};

export function createEidrenClient(apiKey: string, options: EidrenClientOptions = {}) {
  if (!apiKey || !apiKey.startsWith("eid_")) {
    throw new Error("Pass a valid Eidren API key (starts with eid_).");
  }
  const baseUrl = (options.baseUrl ?? EIDREN_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupSupercell = (game: SupercellGame, tag: string) => {
    const endpoint = GAME_ENDPOINTS[game];
    if (!endpoint) throw new Error(`Unknown Supercell game: ${game as string}.`);
    return post<SupercellLookupResult>(apiKey, endpoint, { tag }, baseUrl, fetchImpl);
  };

  return {
    /** Mobile Legends: resolve a nickname from Player ID + Zone ID. */
    lookupMlbb(playerId: string, zoneId: string): Promise<MlbbLookupResult> {
      return post<MlbbLookupResult>(
        apiKey,
        "/api/lookup",
        { playerId, zoneId },
        baseUrl,
        fetchImpl,
      );
    },

    /** Brawl Stars: resolve a nickname from a player tag (e.g. "#2PP"). */
    lookupBrawlStars(tag: string): Promise<SupercellLookupResult> {
      return lookupSupercell("brawl-stars", tag);
    },

    /** Clash of Clans: resolve a nickname from a player tag. */
    lookupClashOfClans(tag: string): Promise<SupercellLookupResult> {
      return lookupSupercell("clash-of-clans", tag);
    },

    /** Clash Royale: resolve a nickname from a player tag. */
    lookupClashRoyale(tag: string): Promise<SupercellLookupResult> {
      return lookupSupercell("clash-royale", tag);
    },

    /** Any Supercell game by slug — useful for game pickers. */
    lookupSupercell(game: SupercellGame, tag: string): Promise<SupercellLookupResult> {
      return lookupSupercell(game, tag);
    },
  };
}

export type EidrenClient = ReturnType<typeof createEidrenClient>;
