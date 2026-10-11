import { lookupSupercellPlayer } from "./supercell.mjs";

/** Clash of Clans player lookup by tag via the official Clash of Clans API. */
export async function lookupClashOfClans(tag, options = {}) {
  return lookupSupercellPlayer("clash-of-clans", tag, options);
}
