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
  adminPassword: { maxAttempts: 5, windowMs: 15 * 60_000, blockMs: 30 * 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const BASE64_URL = /^[A-Za-z0-9_-]+$/;
const ADMIN_PASSWORD_ALGORITHM = "pbkdf2-sha256";
const ADMIN_PASSWORD_MIN_ITERATIONS = 210_000;
const ADMIN_PASSWORD_MAX_ITERATIONS = 1_000_000;
const ADMIN_PASSWORD_MAX_BYTES = 1_024;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlToBytes(value: string) {
  if (!BASE64_URL.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return bytesToBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function parseAdminPasswordHash(encoded: string) {
  const [algorithm, rawIterations, rawSalt, rawHash, extra] = encoded.split("$");
  const iterations = Number(rawIterations);
  const salt = rawSalt ? base64UrlToBytes(rawSalt) : null;
  const hash = rawHash ? base64UrlToBytes(rawHash) : null;
  if (
    extra !== undefined || algorithm !== ADMIN_PASSWORD_ALGORITHM ||
    !Number.isSafeInteger(iterations) || iterations < ADMIN_PASSWORD_MIN_ITERATIONS ||
    iterations > ADMIN_PASSWORD_MAX_ITERATIONS || salt?.byteLength !== 16 || hash?.byteLength !== 32
  ) return null;
  return { iterations, salt, hash };
}

function passwordBytes(password: string) {
  const bytes = new TextEncoder().encode(password);
  return bytes.byteLength > 0 && bytes.byteLength <= ADMIN_PASSWORD_MAX_BYTES ? bytes : null;
}

async function deriveAdminPassword(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  cryptoSource: Crypto,
) {
  const passwordBuffer = Uint8Array.from(password).buffer;
  const saltBuffer = Uint8Array.from(salt).buffer;
  const key = await cryptoSource.subtle.importKey("raw", passwordBuffer, "PBKDF2", false, ["deriveBits"]);
  const bits = await cryptoSource.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Railway stores this encoded verifier; the real admin password is never persisted by the app. */
export async function createAdminPasswordHash(
  password: string,
  options: { iterations?: number; crypto?: Crypto } = {},
) {
  const cryptoSource = options.crypto ?? globalThis.crypto;
  const iterations = options.iterations ?? 310_000;
  const passwordValue = passwordBytes(password);
  if (
    !passwordValue || !Number.isSafeInteger(iterations) ||
    iterations < ADMIN_PASSWORD_MIN_ITERATIONS || iterations > ADMIN_PASSWORD_MAX_ITERATIONS
  ) throw new TypeError("Admin parolası veya PBKDF2 iş yükü geçersiz.");

  const salt = new Uint8Array(16);
  cryptoSource.getRandomValues(salt);
  const hash = await deriveAdminPassword(passwordValue, salt, iterations, cryptoSource);
  return `${ADMIN_PASSWORD_ALGORITHM}$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

export const ADMIN_PASSWORD_MIN_LENGTH = 8;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

/**
 * What the panel accepts as a new admin password.
 *
 * Deliberately a length-and-shape rule rather than a character-class rule: a
 * long passphrase beats a short password with a symbol in it, and control
 * characters are refused because they survive neither a form nor a shell.
 */
export function isAcceptableAdminPassword(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const characters = [...value];
  if (characters.length < ADMIN_PASSWORD_MIN_LENGTH || characters.length > ADMIN_PASSWORD_MAX_LENGTH) {
    return false;
  }
  // Surrounding whitespace survives a form field but not a copy-paste, so it is refused rather than trimmed away.
  if (value.trim() !== value) return false;
  return characters.every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 31 && code !== 127;
  });
}

export function isAdminPasswordHash(value: string) {
  return parseAdminPasswordHash(value) !== null;
}

export async function verifyAdminPassword(
  password: string,
  encoded: string,
  cryptoSource: Crypto = globalThis.crypto,
) {
  const parsed = parseAdminPasswordHash(encoded);
  const passwordValue = passwordBytes(password);
  if (!parsed || !passwordValue) return false;

  const candidate = await deriveAdminPassword(passwordValue, parsed.salt, parsed.iterations, cryptoSource);
  let difference = 0;
  for (let index = 0; index < parsed.hash.byteLength; index += 1) {
    difference |= candidate[index] ^ parsed.hash[index];
  }
  return difference === 0;
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

/**
 * PKCE pair for the authorization-code flow.
 *
 * The verifier never leaves the server: only its S256 challenge travels to the
 * provider, so a stolen authorization code cannot be redeemed without it.
 */
export async function createPkcePair(cryptoSource: Crypto = globalThis.crypto) {
  const bytes = new Uint8Array(32);
  cryptoSource.getRandomValues(bytes);
  const verifier = bytesToBase64Url(bytes);
  const digest = await cryptoSource.subtle.digest("SHA-256", new TextEncoder().encode(verifier));

  return { verifier, challenge: bytesToBase64Url(new Uint8Array(digest)) };
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
