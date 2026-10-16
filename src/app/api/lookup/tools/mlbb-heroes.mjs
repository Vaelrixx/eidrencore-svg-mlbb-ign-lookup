/**
 * MLBB hero explorer over our OWN vendored dataset
 * (`mlbb-heroes.json`, snapshotted from the BSD-3-Clause Rone Arena API on
 * 2026-10-17 with attribution). Zero runtime upstream dependency: no fetch,
 * no key, no quota — the data ships with the app.
 *
 * Provides: hero list (id/name/slug), hero detail (counters, strong-against,
 * teammates resolved to names), and name search. All pure functions over
 * the vendored JSON.
 */

import dataset from "./mlbb-heroes.json" with { type: "json" };

const HEROES = Array.isArray(dataset?.heroes) ? dataset.heroes : [];
const BY_ID = new Map(HEROES.map((hero) => [hero.id, hero]));
const BY_SLUG = new Map(HEROES.map((hero) => [String(hero.slug || "").toLowerCase(), hero]));
const BY_NAME = new Map(HEROES.map((hero) => [String(hero.name || "").toLowerCase(), hero]));

export function datasetMeta() {
  return dataset?._meta ?? { count: HEROES.length };
}

/** List all heroes as { id, name, slug }. */
export function listHeroes() {
  return HEROES.map((hero) => ({ id: hero.id, name: hero.name, slug: hero.slug }));
}

/** Normalize a hero identifier (numeric id, slug, or name). */
export function normalizeHeroIdentifier(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== "string") return null;
  const compact = value.trim().toLowerCase();
  if (!compact || compact.length > 64) return null;
  if (/^\d+$/.test(compact)) return Number.parseInt(compact, 10);
  return compact;
}

function resolveRelated(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => BY_ID.get(id))
    .filter(Boolean)
    .map((hero) => ({ id: hero.id, name: hero.name, slug: hero.slug }));
}

/**
 * Hero detail with relations resolved to names. Returns null when the
 * identifier matches no hero.
 */
export function heroDetail(identifier) {
  const normalized = normalizeHeroIdentifier(identifier);
  if (normalized === null) return null;
  const hero = typeof normalized === "number"
    ? BY_ID.get(normalized)
    : BY_SLUG.get(normalized) ?? BY_NAME.get(normalized);
  if (!hero) return null;
  return {
    id: hero.id,
    name: hero.name,
    slug: hero.slug,
    counters: resolveRelated(hero.counters),
    strongAgainst: resolveRelated(hero.strongAgainst),
    teammates: resolveRelated(hero.teammates),
  };
}

/** Case-insensitive substring search over hero names (max 20 hits). */
export function searchHeroes(query) {
  if (typeof query !== "string") return [];
  const compact = query.trim().toLowerCase();
  if (!compact || compact.length > 64) return [];
  return HEROES
    .filter((hero) => String(hero.name || "").toLowerCase().includes(compact))
    .slice(0, 20)
    .map((hero) => ({ id: hero.id, name: hero.name, slug: hero.slug }));
}
