import type { LookupAttempt } from "../resolve-lookup.mjs";

export function lookupIsan(playerId: string, zoneId: string): Promise<LookupAttempt>;
