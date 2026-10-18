export function rapidApiKeys(options = {}) {
  if (typeof options.apiKey === "string") {
    const key = options.apiKey.trim();
    return key ? [key] : [];
  }
  return [...new Set([
    process.env.RAPIDAPI_KEY_NEW,
    process.env.RAPIDAPI_KEY,
    process.env.RAPIDAPI_APP_TOKEN,
  ].map((key) => typeof key === "string" ? key.trim() : "").filter(Boolean))];
}
