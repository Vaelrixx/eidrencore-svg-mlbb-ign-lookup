export type SafeWebhookTarget = {
  url: string;
  address: string;
  family: 4 | 6;
};
export type WebhookLookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: 4 | 6 }>>;
export function resolveSafeWebhookTarget(raw: string, lookupHost?: WebhookLookup): Promise<SafeWebhookTarget | null>;
export function isSafeWebhookUrl(raw: string, lookupHost?: WebhookLookup): Promise<boolean>;
export function isPublicWebhookAddress(address: string, family: 4 | 6): boolean;
