#!/usr/bin/env node
/**
 * Re-snapshot the owned MLBB hero dataset from the Rone Arena community API
 * (BSD-3-Clause; attribution kept in the JSON `_meta` block).
 *
 * Usage: node scripts/refresh-mlbb-heroes.mjs
 * Run when a new hero releases or relations look stale. Writes
 * src/app/api/lookup/tools/mlbb-heroes.json in place.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src/app/api/lookup/tools/mlbb-heroes.json");
const API = "https://arena.rone.dev/api/heroes?size=200&index=1&order=asc";

const upstream = await fetch(API, {
  headers: { Accept: "application/json", "User-Agent": "EidrenMetaExplorer/1.0 (dataset refresh)" },
  signal: AbortSignal.timeout(30000),
});
if (!upstream.ok) {
  console.error(`refresh failed: HTTP ${upstream.status}`);
  process.exit(1);
}
const payload = await upstream.json();
const records = payload?.data?.records;
if (!Array.isArray(records) || records.length === 0) {
  console.error("refresh failed: no records in response");
  process.exit(1);
}
const heroes = [];
for (const entry of records) {
  const inner = entry?.data ?? {};
  const heroData = inner?.hero?.data ?? {};
  const name = typeof heroData.name === "string" ? heroData.name.trim() : "";
  const id = inner?.hero_id;
  if (!name || !Number.isInteger(id)) continue;
  const relation = inner?.relation ?? {};
  const ids = (key) => {
    const list = relation?.[key]?.target_hero_id;
    return Array.isArray(list) ? list.filter((x) => Number.isInteger(x) && x > 0) : [];
  };
  heroes.push({
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-").replace(/'/g, ""),
    counters: ids("weak"),
    strongAgainst: ids("strong"),
    teammates: ids("assist"),
  });
}
heroes.sort((a, b) => a.id - b.id);
const today = new Date().toISOString().slice(0, 10);
const out = {
  _meta: {
    game: "Mobile Legends: Bang Bang",
    source: `Rone Arena API (BSD-3-Clause), snapshot ${today}`,
    attribution: "Hero data via Rone Arena (github.com/ridwaanhall/rone-arena-api). Unofficial fan data, not affiliated with Moonton.",
    count: heroes.length,
    refresh: "Re-snapshot via scripts/refresh-mlbb-heroes.mjs when a new hero releases.",
  },
  heroes,
};
await writeFile(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${heroes.length} heroes to ${OUT}`);
