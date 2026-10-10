/**
 * Primary-first lookup with deterministic concurrent fallbacks.
 */
export async function resolveLookupWithFallbacks(primaryLookup, fallbackLookups) {
  const primary = await primaryLookup();
  if (primary?.kind === "success") {
    return { primary, fallbacks: [], confirmed: primary };
  }
  const fallbacks = await Promise.all(fallbackLookups.map((lookup) => lookup()));
  const confirmed = fallbacks.find((attempt) => attempt?.kind === "success") ?? null;
  return { primary, fallbacks, confirmed };
}
