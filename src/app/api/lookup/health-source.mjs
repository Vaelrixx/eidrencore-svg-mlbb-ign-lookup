// Legacy aliases: the pulled delta-force slug logged under
// eidren_delta_force; its rows belong to the live Garena game.
// (eidren_undawn has no live game, so it stays unmapped.)
const HEALTH_SOURCE_ALIASES = {
  mlbb_lookup_api: "eidren_mlbb",
  eidren_delta_force: "eidren_delta_force_garena",
};

export function normalizeHealthSource(source) {
  return HEALTH_SOURCE_ALIASES[source] ?? source;
}
