/**
 * Client mirror of the server password policy (api/app/core/password_policy.py).
 * The server is the source of truth; this only gives the user immediate
 * feedback before a roundtrip. Keep the rules in sync with the API.
 */
export const PASSWORD_MIN_LENGTH = 10;

export type PasswordRule = { label: string; ok: (pw: string) => boolean };

export const PASSWORD_RULES: PasswordRule[] = [
  { label: `At least ${PASSWORD_MIN_LENGTH} characters`, ok: (pw) => pw.length >= PASSWORD_MIN_LENGTH },
  { label: "An uppercase letter", ok: (pw) => /[A-Z]/.test(pw) },
  { label: "A lowercase letter", ok: (pw) => /[a-z]/.test(pw) },
  { label: "A number", ok: (pw) => /[0-9]/.test(pw) },
];

export function isPasswordValid(pw: string): boolean {
  return PASSWORD_RULES.every((r) => r.ok(pw));
}
