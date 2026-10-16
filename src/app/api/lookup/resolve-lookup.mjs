/**
 * Primary-first lookup with concurrent, early-return fallbacks.
 * Every fallback is started together, but the caller does not wait for slow
 * fallback providers once one has returned a confirmed nickname.
 */
export async function resolveLookupWithFallbacks(primaryLookup, fallbackLookups) {
  const primary = await primaryLookup();
  if (primary?.kind === "success") {
    return { primary, fallbacks: [], confirmed: primary, pendingFallbacks: 0 };
  }

  const completed = new Array(fallbackLookups.length);
  let resolveFirstSuccess;
  const firstSuccess = new Promise((resolve) => {
    resolveFirstSuccess = resolve;
  });

  const attempts = fallbackLookups.map((lookup, index) => Promise.resolve()
    .then(lookup)
    .catch(() => ({ kind: "unavailable" }))
    .then((attempt) => {
      completed[index] = attempt;
      if (attempt?.kind === "success") {
        resolveFirstSuccess(attempt);
      }
      return attempt;
    }));

  // If no fallback confirms a nickname, wait until every result is known so
  // the route can apply the primary's verdict with full fallback context.
  const allFallbacks = Promise.all(attempts).then((fallbacks) => ({
    type: "complete",
    fallbacks,
  }));
  const outcome = await Promise.race([
    firstSuccess.then((confirmed) => ({ type: "success", confirmed })),
    allFallbacks,
  ]);

  if (outcome.type === "success") {
    const completedFallbacks = completed.filter((attempt) => attempt !== undefined);
    return {
      primary,
      fallbacks: completedFallbacks,
      confirmed: outcome.confirmed,
      pendingFallbacks: fallbackLookups.length - completedFallbacks.length,
    };
  }

  return {
    primary,
    fallbacks: outcome.fallbacks,
    confirmed: outcome.fallbacks.find((attempt) => attempt?.kind === "success") ?? null,
    pendingFallbacks: 0,
  };
}

/**
 * Decide the route verdict from a completed resolution. Any confirmed
 * nickname wins; otherwise the primary's explicit not-found is authoritative
 * (unavailable fallbacks never veto it into a 502).
 */
export function selectLookupVerdict(primary, fallbacks, confirmed) {
  if (confirmed?.kind === "success") return "success";
  const legs = Array.isArray(fallbacks) ? fallbacks : [];
  if (primary?.kind === "not_found" && legs.every((attempt) => attempt?.kind !== "success")) {
    return "not_found";
  }
  if (primary?.kind === "rate_limited" && legs.every((attempt) => attempt?.kind === "rate_limited")) {
    return "rate_limited";
  }
  return "unavailable";
}
