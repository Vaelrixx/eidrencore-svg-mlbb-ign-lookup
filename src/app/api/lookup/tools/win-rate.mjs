/**
 * Win-rate target calculator — pure math, zero upstream dependency.
 *
 * Answers: "I played M matches at W% win rate; how many consecutive wins to
 * reach T%?" plus the symmetric "how many more losses until I drop to L%?".
 * Classic MLBB community tool (MPL-ID-API lineage), fully owned by us.
 *
 * Inputs are plain numbers; outputs are integers with the exact formulas in
 * the response so clients can show their working. No IDs, no network, no
 * secrets — safe to call from anywhere.
 */

const MAX_MATCHES = 100000;
const MAX_PERCENT = 100;

function isValidMatches(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_MATCHES;
}

function isValidPercent(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PERCENT;
}

/**
 * Validate calculator inputs. Returns `{ ok: true, matches, winRate }` or
 * `{ ok: false, error }` with a user-facing message.
 */
export function validateWinRateInput(matches, winRate) {
  if (!isValidMatches(matches)) {
    return { ok: false, error: `Enter total matches as a whole number from 0 to ${MAX_MATCHES}.` };
  }
  if (!isValidPercent(winRate)) {
    return { ok: false, error: "Enter the current win rate as a number from 0 to 100." };
  }
  return { ok: true, matches, winRate };
}

/**
 * Consecutive wins needed from (matches, winRate) to reach `target`%.
 * Returns `{ winsNeeded, projectedMatches }`, or `{ winsNeeded: 0 }` when
 * already at/above target, or `{ impossible: true }` for target 100 with
 * any loss on record.
 */
export function winsToTarget(matches, winRate, target) {
  if (!isValidPercent(target) || target <= winRate) {
    return { winsNeeded: 0, projectedMatches: matches, target };
  }
  const wins = (matches * winRate) / 100;
  if (target >= 100) {
    return wins >= matches && matches > 0
      ? { winsNeeded: 0, projectedMatches: matches, target }
      : { impossible: true, target, reason: "A 100% win rate is unreachable once a match has been lost or drawn." };
  }
  const needed = Math.ceil((target * matches - 100 * wins) / (100 - target));
  return { winsNeeded: Math.max(0, needed), projectedMatches: matches + Math.max(0, needed), target };
}

/**
 * Consecutive losses until (matches, winRate) drops to `floor`%.
 * Returns `{ lossesUntil, projectedMatches }`, or `{ lossesUntil: 0 }` when
 * already at/below the floor.
 */
export function lossesToFloor(matches, winRate, floor) {
  if (!isValidPercent(floor) || floor >= winRate) {
    return { lossesUntil: 0, projectedMatches: matches, floor };
  }
  const wins = (matches * winRate) / 100;
  if (floor <= 0) {
    return wins <= 0
      ? { lossesUntil: 0, projectedMatches: matches, floor }
      : { impossible: true, floor, reason: "A 0% win rate is unreachable while any win is on record." };
  }
  const total = Math.ceil((100 * wins) / floor - matches);
  const lossesUntil = Math.max(0, total);
  return { lossesUntil, projectedMatches: matches + lossesUntil, floor };
}

/**
 * Full calculation for the API route. `targets` and `floors` are optional
 * arrays of percents (defaults: targets [55, 60, 70], floors [50, 45]).
 */
export function calculateWinRate(matches, winRate, { targets = [55, 60, 70], floors = [50, 45] } = {}) {
  const valid = validateWinRateInput(matches, winRate);
  if (!valid.ok) return valid;
  const cleanTargets = [...new Set(targets.filter(isValidPercent))].slice(0, 5);
  const cleanFloors = [...new Set(floors.filter(isValidPercent))].slice(0, 5);
  const wins = (matches * winRate) / 100;
  return {
    ok: true,
    matches,
    winRate,
    currentWins: Math.round(wins * 100) / 100,
    currentLosses: Math.round((matches - wins) * 100) / 100,
    targets: cleanTargets.map((target) => winsToTarget(matches, winRate, target)),
    floors: cleanFloors.map((floor) => lossesToFloor(matches, winRate, floor)),
  };
}
