export const AUTH_SIGNIN_WINDOW_SECONDS: number;
export const AUTH_SIGNIN_MAX_REQUESTS: number;
export const AUTH_SIGNUP_WINDOW_SECONDS: number;
export const AUTH_SIGNUP_MAX_REQUESTS: number;
export const AUTH_RECOVERY_WINDOW_SECONDS: number;
export const AUTH_RECOVERY_MAX_REQUESTS: number;

export type AuthAttemptResult = {
  enabled: boolean;
  allowed: boolean;
  retryAfterSeconds: number;
  remaining?: number;
  degraded?: boolean;
};

export function consumeAuthAttempt(
  request: Request,
  scope: string,
  options?: {
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
    logger?: (line: string) => void;
    windowSeconds: number;
    maxRequests: number;
  },
): Promise<AuthAttemptResult>;
