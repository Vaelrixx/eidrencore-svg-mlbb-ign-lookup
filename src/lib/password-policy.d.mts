export const PASSWORD_MIN_LENGTH: number;
export const PASSWORD_MAX_LENGTH: number;
export const PASSWORD_MIN_SCORE: number;

export type PasswordCheck = {
  ok: boolean;
  score: number;
  reasons: string[];
};

export function checkPasswordStrength(password: unknown, email?: string): PasswordCheck;
export function passwordErrorMessage(password: unknown, email?: string): string | null;
