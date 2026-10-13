const NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function createContentSecurityPolicy(nonce) {
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) {
    throw new TypeError("Invalid Content Security Policy nonce.");
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
