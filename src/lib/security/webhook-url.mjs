import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const NON_PUBLIC_IPV4 = new BlockList();
for (const [subnet, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) NON_PUBLIC_IPV4.addSubnet(subnet, prefix, "ipv4");

const GLOBAL_UNICAST_IPV6 = new BlockList();
GLOBAL_UNICAST_IPV6.addSubnet("2000::", 3, "ipv6");
const NON_PUBLIC_IPV6 = new BlockList();
for (const [subnet, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3ffe::", 16], ["3fff::", 20],
]) NON_PUBLIC_IPV6.addSubnet(subnet, prefix, "ipv6");

function isPublicIpv4(address) {
  return isIP(address) === 4 && !NON_PUBLIC_IPV4.check(address, "ipv4");
}

function isPublicIpv6(address) {
  const normalized = address.toLowerCase().split("%", 1)[0];
  return isIP(normalized) === 6 && GLOBAL_UNICAST_IPV6.check(normalized, "ipv6") && !NON_PUBLIC_IPV6.check(normalized, "ipv6");
}

export function isPublicWebhookAddress(address, family) {
  if (family === 4) return isIP(address) === 4 && isPublicIpv4(address);
  if (family === 6) return isIP(address) === 6 && isPublicIpv6(address);
  return false;
}

/**
 * Resolve and validate a public HTTPS webhook destination exactly once. The
 * returned address must be used for the connection; resolving the URL again
 * during delivery would reintroduce a DNS-rebinding check/use race.
 */
export async function resolveSafeWebhookTarget(raw, lookupHost = dnsLookup) {
  try {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) return null;

    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal") return null;

    const literalFamily = isIP(host);
    if (literalFamily === 6) return null;
    if (literalFamily === 4) {
      if (!isPublicIpv4(host)) return null;
      return { url: url.toString(), address: host, family: 4 };
    }

    url.hostname = host;
    const records = await lookupHost(host, { all: true, verbatim: true });
    if (!Array.isArray(records) || records.length === 0) return null;
    if (!records.every(record => isPublicWebhookAddress(record.address, record.family))) return null;

    const selected = records[0];
    return { url: url.toString(), address: selected.address, family: selected.family };
  } catch {
    return null;
  }
}

export async function isSafeWebhookUrl(raw, lookupHost = dnsLookup) {
  return (await resolveSafeWebhookTarget(raw, lookupHost)) !== null;
}
