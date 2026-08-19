import { SESSION_COOKIE_NAME } from "./auth-security.ts";
import type { ActiveSessionResult } from "../infra/postgres/auth-repository.ts";

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type PublicSessionView = {
  authenticated: true;
  user: { displayName: string; email: string };
  session: { expiresAt: string };
};

/**
 * Reads the host-only session cookie. A malformed duplicate never masks a valid
 * cookie, and a value that fails the token shape is discarded before any lookup.
 */
export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;

    const value = entry.slice(separator + 1).trim();
    if (OPAQUE_TOKEN.test(value)) return value;
  }

  return null;
}

/** Exposes only the owner's own identity fields; never session or family identifiers. */
export function publicSessionView(session: ActiveSessionResult): PublicSessionView {
  return {
    authenticated: true,
    user: { displayName: session.displayName, email: session.email },
    session: { expiresAt: session.expiresAt.toISOString() },
  };
}
