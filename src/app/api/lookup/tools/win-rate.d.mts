export type WinRateValidation =
  | { ok: true; matches: number; winRate: number }
  | { ok: false; error: string };

export type WinsToTargetResult =
  | { winsNeeded: number; projectedMatches: number; target: number }
  | { impossible: true; target: number; reason: string };

export type LossesToFloorResult =
  | { lossesUntil: number; projectedMatches: number; floor: number }
  | { impossible: true; floor: number; reason: string };

export type WinRateCalculation =
  | {
      ok: true;
      matches: number;
      winRate: number;
      currentWins: number;
      currentLosses: number;
      targets: WinsToTargetResult[];
      floors: LossesToFloorResult[];
    }
  | { ok: false; error: string };

export type WinRateOptions = {
  targets?: number[];
  floors?: number[];
};

export declare function validateWinRateInput(
  matches: number,
  winRate: number,
): WinRateValidation;

export declare function winsToTarget(
  matches: number,
  winRate: number,
  target: number,
): WinsToTargetResult;

export declare function lossesToFloor(
  matches: number,
  winRate: number,
  floor: number,
): LossesToFloorResult;

export declare function calculateWinRate(
  matches: number,
  winRate: number,
  options?: WinRateOptions,
): WinRateCalculation;
