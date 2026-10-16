/**
 * CODM input modes shared by the route field validator and the split-leg
 * dispatcher (single source of truth so validation and routing never drift).
 *
 * - All-digit inputs ("8370310025568788000") stay on the keyed provider leg.
 * - Anything else valid ("ShadowHex", "6QKPNM") goes direct to the Coda
 *   white-label voucher, which rejects long numeric UIDs with "UID invalid".
 *
 * Kept in .mjs (not the .ts route file) so node:test can import it without
 * dragging in next/server.
 */

export const CODM_IDENTITY_PATTERN = /^[\p{L}\p{N} _.'-]{3,24}$/u;

const ALL_DIGITS = /^\d+$/;

/**
 * Route an already-validated CODM identity to its leg. Returns "keyed" for
 * all-digit input, "direct" for nickname/shortId input, or null when the
 * value fails the shared identity pattern.
 */
export function classifyCodmInput(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!CODM_IDENTITY_PATTERN.test(trimmed)) return null;
  return ALL_DIGITS.test(trimmed) ? "keyed" : "direct";
}
