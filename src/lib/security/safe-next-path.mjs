const VALIDATION_ORIGIN = "https://eidren.invalid";

function hasControlCharacters(value) {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export function safeNextPath(value, fallback = "/dashboard") {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacters(value)
  ) return fallback;

  try {
    const parsed = new URL(value, VALIDATION_ORIGIN);
    if (parsed.origin !== VALIDATION_ORIGIN) return fallback;

    // Reject path separators that become external/network paths after repeated
    // percent-decoding by a browser, router, or upstream proxy.
    let pathname = parsed.pathname;
    for (let i = 0; i < 4; i += 1) {
      let decoded;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        return fallback;
      }
      if (decoded === pathname) break;
      pathname = decoded;
      if (
        !pathname.startsWith("/") ||
        pathname.startsWith("//") ||
        pathname.includes("\\") ||
        hasControlCharacters(pathname)
      ) return fallback;
    }
    return value;
  } catch {
    return fallback;
  }
}
