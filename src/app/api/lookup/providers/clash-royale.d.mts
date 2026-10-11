import type { LookupAttempt } from "./supercell.mjs";

export function lookupClashRoyale(
  tag: string,
  options?: {
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  },
): Promise<LookupAttempt>;
