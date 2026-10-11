import { lookupSupercellPlayer } from "./supercell.mjs";

/** Clash Royale player lookup by tag via the official Clash Royale API. */
export async function lookupClashRoyale(tag, options = {}) {
  return lookupSupercellPlayer("clash-royale", tag, options);
}
