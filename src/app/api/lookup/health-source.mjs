export function normalizeHealthSource(source) {
  return source === "mlbb_lookup_api" ? "eidren_mlbb" : source;
}
