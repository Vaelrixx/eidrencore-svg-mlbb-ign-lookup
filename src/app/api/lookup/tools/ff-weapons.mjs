/**
 * Free Fire weapon reference over our OWN curated dataset
 * (`ff-weapons.json`, hand-maintained roster facts). Zero runtime upstream
 * dependency: no fetch, no key, no quota — the data ships with the app.
 *
 * Roster facts only (name, class, ammo, slot). Damage, fire-rate, and range
 * numbers change per OB patch, so they are intentionally excluded rather
 * than vendored stale.
 *
 * Provides: weapon list, class/ammo filters, and name search. All pure
 * functions over the vendored JSON.
 */

import dataset from "./ff-weapons.json" with { type: "json" };

const WEAPONS = Array.isArray(dataset?.weapons) ? dataset.weapons : [];

export function datasetMeta() {
  return dataset?._meta ?? { count: WEAPONS.length };
}

/** List all weapons as { name, class, ammo, slot }. */
export function listWeapons() {
  return WEAPONS.map((weapon) => ({
    name: weapon.name,
    class: weapon.class,
    ammo: weapon.ammo,
    slot: weapon.slot,
  }));
}

/** Filter weapons by class (e.g. "smg", "sniper") or ammo type (e.g. "AR"). */
export function filterWeapons({ class: weaponClass, ammo } = {}) {
  const classFilter = typeof weaponClass === "string" ? weaponClass.trim().toLowerCase() : "";
  const ammoFilter = typeof ammo === "string" ? ammo.trim().toLowerCase() : "";
  return listWeapons().filter(
    (weapon) =>
      (!classFilter || String(weapon.class || "").toLowerCase() === classFilter) &&
      (!ammoFilter || String(weapon.ammo || "").toLowerCase() === ammoFilter),
  );
}

/** Case-insensitive substring search over weapon names (max 20 hits). */
export function searchWeapons(query) {
  if (typeof query !== "string") return [];
  const compact = query.trim().toLowerCase();
  if (!compact || compact.length > 64) return [];
  return listWeapons()
    .filter((weapon) => String(weapon.name || "").toLowerCase().includes(compact))
    .slice(0, 20);
}
