import type { SafeWebhookTarget } from "./webhook-url.mjs";
export function createPinnedLookup(address: string, family?: 4 | 6): (...args: unknown[]) => void;
export function postHttpsJsonPinned(
  target: SafeWebhookTarget,
  headers: Record<string, string>,
  body: string,
  timeoutMs?: number,
): Promise<{ status: number; ok: boolean }>;
