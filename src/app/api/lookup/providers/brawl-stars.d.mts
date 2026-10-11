import type { LookupAttempt } from "./supercell.mjs";

export function lookupBrawlStars(
  tag: string,
  options?: {
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  },
): Promise<LookupAttempt>;
