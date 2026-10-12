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
  {
    id: "brawl-stars-club-lookup",
    name: "Club lookup",
    game: "Brawl Stars",
    description: "Resolve a club name and roster summary from a club tag.",
    status: "live",
    href: "/dashboard/playground?game=brawl-stars",
  },
  {
    id: "clash-of-clans-clan-lookup",
    name: "Clan lookup",
    game: "Clash of Clans",
    description: "Resolve a clan name and roster summary from a clan tag.",
    status: "live",
    href: "/dashboard/playground?game=clash-of-clans",
  },
  {
    id: "clash-royale-clan-lookup",
    name: "Clan lookup",
    game: "Clash Royale",
    description: "Resolve a clan name and roster summary from a clan tag.",
    status: "live",
    href: "/dashboard/playground?game=clash-royale",
  },
  {
    id: "brawl-stars-battles",
    name: "Battle history",
    game: "Brawl Stars",
    description: "Recent battles for a player tag (max 25).",
    status: "live",
    href: "/dashboard/playground?game=brawl-stars",
  },
  {
    id: "clash-of-clans-warlog",
    name: "War log",
    game: "Clash of Clans",
    description: "Recent clan wars for a clan tag (max 25).",
    status: "live",
    href: "/dashboard/playground?game=clash-of-clans",
  },
  {
    id: "clash-royale-battles",
    name: "Battle history",
    game: "Clash Royale",
    description: "Recent battles for a player tag (max 25).",
    status: "live",
    href: "/dashboard/playground?game=clash-royale",
  },
  {
    id: "brawl-stars-rankings",
    name: "Rankings",
    game: "Brawl Stars",
    description: "Top players for a location (global or country code).",
    status: "live",
    href: "/dashboard/playground?game=brawl-stars",
  },
  {
    id: "clash-of-clans-rankings",
    name: "Rankings",
    game: "Clash of Clans",
    description: "Top players for a location (global or numeric ID).",
    status: "live",
    href: "/dashboard/playground?game=clash-of-clans",
  },
  {
    id: "clash-royale-rankings",
    name: "Rankings",
    game: "Clash Royale",
    description: "Top players for a location (global or numeric ID).",
    status: "live",
    href: "/dashboard/playground?game=clash-royale",
  },
];
