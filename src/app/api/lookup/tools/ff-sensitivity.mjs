/**
 * Free Fire sensitivity preset generator — pure editorial data, zero
 * upstream dependency.
 *
 * Answers: "I play on a low/mid/flagship phone — what sensitivity values
 * should I start from?" Presets are midpoints of the widely-published
 * community ranges for the six in-game sliders (0-200 scale), with
 * per-tier tuning notes. No game API, no IDs, no secrets.
 *
 * Ranges grounded in the Oct 2026 Cashify device-tier guide; values are
 * starting points, not guarantees — the response says so explicitly.
 */

const SLIDERS = ["general", "redDot", "scope2x", "scope4x", "sniper", "freeLook"];

const PRESETS = {
  low: {
    tier: "low",
    label: "Low-end (2-4GB RAM, unstable FPS)",
    values: { general: 192, redDot: 187, scope2x: 172, scope4x: 157, sniper: 105, freeLook: 150 },
    notes: [
      "Higher values offset input lag on slower hardware.",
      "Lock graphics to Smooth and cap FPS for consistency.",
      "Start with gyroscope off; add it later once aim feels stable.",
    ],
  },
  balanced: {
    tier: "balanced",
    label: "Balanced (4GB+ RAM, stable 60 FPS)",
    values: { general: 180, redDot: 175, scope2x: 160, scope4x: 150, sniper: 95, freeLook: 135 },
    notes: [
      "High General/Red Dot for close fights; scopes drop for stability.",
      "On 120Hz+ flagships, drop every slider 5-8% from these values.",
      "Adjust one slider at a time in Training Ground, 5-10 points per step.",
    ],
  },
  aggressive: {
    tier: "aggressive",
    label: "Aggressive (8GB+ RAM, claw / 4-finger grip)",
    values: { general: 190, redDot: 185, scope2x: 170, scope4x: 160, sniper: 105, freeLook: 155 },
    notes: [
      "Snappier values for fast pushes and close-quarters dominance.",
      "Claw grip frees the thumbs, so the higher end stays controllable.",
      "Pairs well with a slightly smaller fire button for more drag runway.",
    ],
  },
};

const DISCLAIMER =
  "Starting presets only — no sensitivity guarantees headshots or zero recoil. " +
  "Test in Training Ground and adjust 5-10 points at a time. Unofficial fan " +
  "reference, not affiliated with Garena.";

export function sensitivityTiers() {
  return Object.keys(PRESETS);
}

/** Normalize a tier input ("low", "mid", "balanced", "high", "aggressive", ...). */
export function normalizeTier(value) {
  if (typeof value !== "string") return null;
  const compact = value.trim().toLowerCase();
  if (["low", "low-end", "beginner", "2gb", "3gb", "4gb-"].includes(compact)) return "low";
  if (["balanced", "mid", "medium", "mid-range", "standard", "default"].includes(compact)) return "balanced";
  if (["aggressive", "high", "flagship", "pro", "claw", "8gb"].includes(compact)) return "aggressive";
  return null;
}

/**
 * Preset for a device tier. Returns `{ ok: true, ...preset }` or
 * `{ ok: false, error }` for unknown tiers.
 */
export function sensitivityPreset(tier) {
  const normalized = normalizeTier(tier);
  if (!normalized) {
    return {
      ok: false,
      error: `Unknown tier "${String(tier).slice(0, 32)}". Use one of: ${sensitivityTiers().join(", ")}.`,
    };
  }
  const preset = PRESETS[normalized];
  return {
    ok: true,
    tier: preset.tier,
    label: preset.label,
    values: { ...preset.values },
    sliders: [...SLIDERS],
    scale: "0-200 per slider",
    notes: [...preset.notes],
    disclaimer: DISCLAIMER,
  };
}
