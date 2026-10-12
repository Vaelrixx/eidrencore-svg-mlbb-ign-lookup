export type SupercellGameKey = "brawl-stars" | "clash-of-clans" | "clash-royale";

/**
 * One-click sample inputs for the playground. These mirror the documented
 * example fixtures so a single click runs a real lookup without typing.
 */
export const MLBB_SAMPLE = { playerId: "1114917746", zoneId: "13486" } as const;

export const SUPERCELL_PLAYER_SAMPLE: Record<SupercellGameKey, string> = {
  "brawl-stars": "#2PP",
  "clash-of-clans": "#2PP",
  "clash-royale": "#C0G20PR2",
};

export const SUPERCELL_GROUP_SAMPLE: Record<SupercellGameKey, string> = {
  "brawl-stars": "#2PP",
  "clash-of-clans": "#2PP",
  "clash-royale": "#C0G20PR2",
};

export const SUPERCELL_HISTORY_SAMPLE: Record<SupercellGameKey, string> = {
  "brawl-stars": "#2PP",
  "clash-of-clans": "#2PP",
  "clash-royale": "#C0G20PR2",
};

export const RANKINGS_SAMPLE_LOCATION = "global";
