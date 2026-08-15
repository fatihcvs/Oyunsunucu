export const DEFAULT_AUTH_RETURN_TO = "/panel";
export const CURRENT_CONSENT_VERSION = "kvkk-iletisim-v1-2026-08-14";

export type AuthMode = "signin" | "register";

export type AuthRequest = {
  mode: AuthMode;
  returnTo: string;
};

export type RegistrationIntent = {
  displayName: string;
  email: string;
  consentVersion: typeof CURRENT_CONSENT_VERSION;
  returnTo: string;
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

export function isValidEmail(value: string) {
  const normalized = normalizeEmail(value);
  return normalized.length <= 254 && EMAIL_ADDRESS.test(normalized);
}

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidDisplayName(value: string) {
  const normalized = normalizeDisplayName(value);
  return normalized.length >= 2 && normalized.length <= 60 && !CONTROL_CHARACTERS.test(normalized);
}

export function isSafeReturnPath(value: string | null | undefined): value is string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || CONTROL_CHARACTERS.test(value)) {
    return false;
  }

  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || decoded.includes("\\") || CONTROL_CHARACTERS.test(decoded)) return false;
    const parsed = new URL(value, "https://riftory.invalid");
    return parsed.origin === "https://riftory.invalid";
  } catch {
    return false;
  }
}

export function resolveAuthRequest(mode: string | null | undefined, returnTo: string | null | undefined): AuthRequest {
  return {
    mode: mode === "register" ? "register" : "signin",
    returnTo: isSafeReturnPath(returnTo) ? returnTo : DEFAULT_AUTH_RETURN_TO,
  };
}

export function createRegistrationIntent(input: { displayName: string; email: string; returnTo?: string | null }): RegistrationIntent | null {
  if (!isValidDisplayName(input.displayName) || !isValidEmail(input.email)) return null;

  return {
    displayName: normalizeDisplayName(input.displayName),
    email: normalizeEmail(input.email),
    consentVersion: CURRENT_CONSENT_VERSION,
    returnTo: isSafeReturnPath(input.returnTo) ? input.returnTo : DEFAULT_AUTH_RETURN_TO,
  };
}
