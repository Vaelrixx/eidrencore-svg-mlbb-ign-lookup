export type LookupAttempt =
  | { kind: "success"; nickname: string; country?: string; source: string }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

export function resolveLookupWithFallbacks(
  primaryLookup: () => Promise<LookupAttempt>,
  fallbackLookups: Array<() => Promise<LookupAttempt>>,
): Promise<{
  primary: LookupAttempt;
  fallbacks: LookupAttempt[];
  confirmed: LookupAttempt | null;
  pendingFallbacks: number;
}>;
