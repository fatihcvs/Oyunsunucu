import { isServerDraft, type ServerDraft } from "./catalog.ts";

export const SESSION_COOKIE_NAME = "__Host-riftory_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type SessionRecord = {
  expiresAt: Date | string;
  revokedAt?: Date | string | null;
};

export type RateLimitPolicy = {
  maxAttempts: number;
  windowMs: number;
  blockMs: number;
};

export type RateLimitState = {
  attempts: number;
  windowStartedAtMs: number;
  blockedUntilMs: number | null;
};

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  nextState: RateLimitState;
};

export type DeviceDraftImportCommand = {
  ownerUserId: string;
  importKey: string;
  payloadHash: string;
  draft: ServerDraft;
};

export class ResourceAccessError extends Error {
  readonly code = "RESOURCE_NOT_FOUND";
  readonly status = 404;

  constructor() {
    super("Kaynak bulunamadı.");
    this.name = "ResourceAccessError";
  }
}

export const AUTH_RATE_LIMIT_POLICIES = {
  magicLink: { maxAttempts: 5, windowMs: 15 * 60_000, blockMs: 30 * 60_000 },
  discordStart: { maxAttempts: 20, windowMs: 15 * 60_000, blockMs: 15 * 60_000 },
  callback: { maxAttempts: 10, windowMs: 10 * 60_000, blockMs: 30 * 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string, cryptoSource: Crypto = globalThis.crypto) {
  const digest = await cryptoSource.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function createOpaqueToken(cryptoSource: Crypto = globalThis.crypto) {
  const bytes = new Uint8Array(32);
  cryptoSource.getRandomValues(bytes);
  const rawToken = bytesToBase64Url(bytes);

  return {
    rawToken,
    tokenHash: await sha256Hex(rawToken, cryptoSource),
  };
}

export function buildSessionCookie(rawToken: string, now = new Date()) {
  if (!OPAQUE_TOKEN.test(rawToken)) throw new TypeError("Geçersiz oturum belirteci.");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  return `${SESSION_COOKIE_NAME}=${rawToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}; Expires=${expiresAt.toUTCString()}`;
}

export function buildExpiredSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function isSessionActive(session: SessionRecord, now = new Date()) {
  if (session.revokedAt) return false;
  const expiresAt = session.expiresAt instanceof Date ? session.expiresAt : new Date(session.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
}

export function assertResourceOwner(actorUserId: string | null | undefined, ownerUserId: string | null | undefined) {
  if (!actorUserId || !ownerUserId || actorUserId !== ownerUserId) throw new ResourceAccessError();
}

export function isAllowedMutationOrigin(origin: string | null | undefined, allowedOrigins: readonly string[]) {
  if (!origin) return false;

  try {
    const candidate = new URL(origin);
    if (candidate.pathname !== "/" || candidate.search || candidate.hash) return false;
    return allowedOrigins.some((allowed) => {
      try {
        return candidate.origin === new URL(allowed).origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function evaluateFixedWindowRateLimit(
  state: RateLimitState | null,
  policy: RateLimitPolicy,
  nowMs = Date.now(),
): RateLimitDecision {
  if (state?.blockedUntilMs && state.blockedUntilMs > nowMs) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: state.blockedUntilMs - nowMs,
      nextState: state,
    };
  }

  const activeState = !state || nowMs - state.windowStartedAtMs >= policy.windowMs
    ? { attempts: 0, windowStartedAtMs: nowMs, blockedUntilMs: null }
    : { ...state, blockedUntilMs: null };

  const attempts = activeState.attempts + 1;
  const exceeded = attempts > policy.maxAttempts;
  const blockedUntilMs = exceeded ? nowMs + policy.blockMs : null;

  return {
    allowed: !exceeded,
    remaining: Math.max(0, policy.maxAttempts - attempts),
    retryAfterMs: exceeded ? policy.blockMs : 0,
    nextState: { attempts, windowStartedAtMs: activeState.windowStartedAtMs, blockedUntilMs },
  };
}

export async function createRateLimitBucketKey(scope: string, discriminator: string) {
  return sha256Hex(`${scope.trim().toLowerCase()}:${discriminator.trim().toLowerCase()}`);
}

export async function createSecretRateLimitBucketKey(
  secret: string,
  scope: string,
  discriminator: string,
  cryptoSource: Crypto = globalThis.crypto,
) {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new TypeError("Oran sınırlama sırrı en az 32 bayt olmalıdır.");
  }
  const key = await cryptoSource.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await cryptoSource.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${scope.trim().toLowerCase()}:${discriminator.trim().toLowerCase()}`),
  );
  return bytesToHex(new Uint8Array(digest));
}

function canonicalDraft(draft: ServerDraft) {
  return JSON.stringify({
    backups: draft.backups,
    gameId: draft.gameId,
    planId: draft.planId,
    regionId: draft.regionId,
    serverName: draft.serverName.trim(),
    softwareId: draft.softwareId,
  });
}

export async function createDeviceDraftImportCommand(input: {
  actorUserId: string;
  importKey: string;
  draft: unknown;
}): Promise<DeviceDraftImportCommand | null> {
  if (!UUID.test(input.actorUserId) || !UUID.test(input.importKey) || !isServerDraft(input.draft)) return null;

  return {
    ownerUserId: input.actorUserId,
    importKey: input.importKey.toLowerCase(),
    payloadHash: await sha256Hex(canonicalDraft(input.draft)),
    draft: input.draft,
  };
}
