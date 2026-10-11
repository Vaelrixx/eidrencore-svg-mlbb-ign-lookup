export type ToolStatus = "live" | "planned";

export type PlatformTool = {
  id: string;
  name: string;
  game: string;
  description: string;
  status: ToolStatus;
  /** Where the tool can be tried. Planned tools have no route yet. */
  href?: string;
};

/**
 * Single list the landing page, playground and console read from.
 * To ship a new tool: add an entry here, mark it "live" and give it an href.
 */
export const platformTools: PlatformTool[] = [
  {
    id: "mlbb-player-lookup",
    name: "Player lookup",
    game: "Mobile Legends",
    description: "Resolve an in-game name from a Player ID and Zone ID.",
    status: "live",
    href: "/playground",
  },
  { id: "freefire-player-lookup", name: "Player lookup", game: "Free Fire", description: "Player identity by UID.", status: "planned" },
  { id: "pubg-player-lookup", name: "Player lookup", game: "PUBG Mobile", description: "Player identity by character ID.", status: "planned" },
  { id: "codm-player-lookup", name: "Player lookup", game: "Call of Duty: Mobile", description: "Player identity by UID.", status: "planned" },
  {
    id: "brawl-stars-player-lookup",
    name: "Player lookup",
    game: "Brawl Stars",
    description: "Resolve a player name from a Supercell player tag.",
    status: "live",
    href: "/dashboard/playground?game=brawl-stars",
  },
  {
    id: "clash-of-clans-player-lookup",
    name: "Player lookup",
    game: "Clash of Clans",
    description: "Resolve a player name from a Supercell player tag.",
    status: "live",
    href: "/dashboard/playground?game=clash-of-clans",
  },
  {
    id: "clash-royale-player-lookup",
    name: "Player lookup",
    game: "Clash Royale",
    description: "Resolve a player name from a Supercell player tag.",
    status: "live",
    href: "/dashboard/playground?game=clash-royale",
  },
];
