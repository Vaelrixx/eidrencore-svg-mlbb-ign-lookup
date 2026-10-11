/**
 * Free-tier password policy.
 *
 * Supabase's HaveIBeenPwned-backed leaked-password protection requires Pro,
 * so this app enforces its own baseline: length, character variety, and a
 * small denylist of extremely common passwords. This is not a replacement for
 * server-side breach-corpus checking; it only raises the cost of weak,
 * guessable, and credential-stuffed passwords until the project upgrades.
 *
 * Keep this module dependency-free so both route handlers and unit tests can
 * import it directly. Never log or persist the candidate password.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MIN_SCORE = 3;

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "password12345",
  "123456",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwerty123",
  "letmein",
  "welcome",
  "welcome1",
  "welcome123",
  "admin123",
  "changeme",
  "iloveyou",
  "football",
  "monkey",
  "dragon",
  "master",
  "sunshine",
  "princess",
  "superman",
  "michael",
  "shadow",
  "passw0rd",
  "p@ssw0rd",
  "p@ssword",
  "eidren",
  "eidren123",
  "mobilelegends",
  "mobilelegends123",
  "mlbb123",
  "mlbb1234",
]);

function normalize(password) {
  return typeof password === "string" ? password : "";
}

/**
 * Score a candidate password from 0-4 based on length and character variety.
 * Common-password and e-mail-local-part checks fail closed regardless of score.
 */
export function checkPasswordStrength(password, email = "") {
  const value = normalize(password);
  const reasons = [];

  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    reasons.push(`Use a password between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`);
  }

  const lowered = value.toLowerCase();
  if (value && COMMON_PASSWORDS.has(lowered)) {
    reasons.push("That password is too common. Choose a unique password you do not reuse elsewhere.");
  }

  const localPart = typeof email === "string" ? email.trim().toLowerCase().split("@")[0] : "";
  if (value && localPart && localPart.length >= 4 && lowered.includes(localPart)) {
    reasons.push("Do not include your email address in your password.");
  }

  let score = 0;
  if (value.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;

  if (value.length >= PASSWORD_MIN_LENGTH && score < PASSWORD_MIN_SCORE) {
    reasons.push("Add a mix of upper/lowercase letters, numbers, and symbols — longer passphrases work well.");
  }

  return { ok: reasons.length === 0, score: Math.min(4, score), reasons };
}

export function passwordErrorMessage(password, email = "") {
  const result = checkPasswordStrength(password, email);
  return result.ok ? null : result.reasons[0];
}
