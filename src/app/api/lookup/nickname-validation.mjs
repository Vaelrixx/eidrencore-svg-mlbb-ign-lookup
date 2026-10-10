const PLACEHOLDER_NICKNAMES = new Set([
  "null", "undefined", "not found", "player not found", "user not found",
  "invalid id", "invalid user", "invalid player", "unknown", "unknown user",
  "unknown player", "error", "failed", "success", "ok", "true", "false",
  "n/a", "n.a.", "n.a", "na", "none", "nil", "not available",
  "unavailable", "no nickname", "no name", "guest", "-", "--", "0",
]);

const PLACEHOLDER_TOKENS = new Set([
  "na", "none", "nil", "null", "undefined", "notfound", "playernotfound",
  "usernotfound", "unknown", "unknownuser", "unknownplayer", "error",
  "failed", "success", "notavailable", "unavailable", "nonickname", "noname",
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function stringField(source, keys) {
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function cleanNickname(value) {
  if (typeof value !== "string") return "";
  const normalized = value.replaceAll("+", "%20");
  try {
    return decodeURIComponent(normalized).trim();
  } catch {
    return value.trim();
  }
}

/**
 * High-precision nickname guard shared by every provider, including Codashop.
 * Reject common upstream placeholders and error text before it reaches clients.
 */
export function isUsableNickname(value) {
  if (typeof value !== "string") return false;
  const cleaned = cleanNickname(value);
  if (!cleaned || cleaned.length > 64) return false;

  const normalized = cleaned.toLowerCase().replace(/\s+/g, " ").trim();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  if (PLACEHOLDER_NICKNAMES.has(normalized) || PLACEHOLDER_TOKENS.has(compact)) {
    return false;
  }
  if (/^(error|failed|invalid|not found|unknown)\b/i.test(cleaned)) return false;
  if (/^(please )?(try again|contact support|something went wrong)\b/i.test(cleaned)) {
    return false;
  }
  return true;
}

export function confirmedNickname(payload) {
  const root = record(payload);
  if (!root) return "";

  const data = record(root.data);
  const result = record(root.result);
  const nested = record(data?.data);

  // A payload carrying an explicit error/invalid flag is never a success.
  const rootError = typeof root.error === "string" ? root.error.trim() : "";
  const dataError = typeof data?.error === "string" ? data.error.trim() : "";
  if (
    root.success === false ||
    root.error === true ||
    Boolean(rootError) ||
    root.status === false ||
    root.status === "error" ||
    root.valid === false ||
    data?.success === false ||
    data?.error === true ||
    Boolean(dataError) ||
    data?.status === false ||
    data?.valid === false
  ) return "";

  const candidates = [root, data, result, nested];
  for (const candidate of candidates) {
    const value = stringField(candidate, [
      "username", "nickname", "name", "ign", "gameName", "playerName", "roleName",
    ]);
    if (!isUsableNickname(value)) continue;
    return cleanNickname(value);
  }
  return "";
}
