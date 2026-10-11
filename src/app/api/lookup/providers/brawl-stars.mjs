import { lookupSupercellPlayer } from "./supercell.mjs";

/** Brawl Stars player lookup by tag via the official Brawl Stars API. */
export async function lookupBrawlStars(tag, options = {}) {
  return lookupSupercellPlayer("brawl-stars", tag, options);
}
