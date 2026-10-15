export function requiresSameOriginProtection(method: string, pathname: string, authorization?: string): boolean;
export function isSameOriginRequest(originHeader: string | null, refererHeader: string | null, expectedOrigin: string): boolean;
