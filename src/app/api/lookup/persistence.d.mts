export function enforceLookupRateLimit(
  request: unknown,
  options?: Record<string, unknown>,
): Promise<{ enabled: boolean; allowed: boolean; retryAfterSeconds: number; remaining?: number; degraded?: boolean }>;
export function enforcePlaygroundLimit(
  userId: string,
  options?: Record<string, unknown>,
): Promise<{ enabled: boolean; allowed: boolean; retryAfterSeconds: number; remaining?: number; degraded?: boolean }>;
export function persistLookupLog(
  input: {
    status: "success" | "invalid_input" | "not_found" | "upstream_error" | "rate_limited";
    responseMs?: number;
    source?: string;
    failureReason?: string | null;
  },
  options?: Record<string, unknown>,
): Promise<{ persisted: boolean; configured?: boolean; reason?: string }>;
